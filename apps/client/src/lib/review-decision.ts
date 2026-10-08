import * as Cloudflare from 'alchemy/Cloudflare/Bridge'
import { createServerFn } from '@tanstack/react-start'
import { makeFunctionReference } from 'convex/server'
import { Effect, Schema } from 'effect'
import * as HttpBody from 'effect/http/HttpBody'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import { publicErrorMessage } from '@patchplane/domain/errors'
import { convexMutation } from '@patchplane/plugins/convex/http-client'
import {
  criticalPathStages,
  withCriticalPathTransition,
} from '@patchplane/core/services/telemetry-service'
import {
  CandidatePatchSetId,
  HumanDecisionId,
  PolicyDecisionId,
  ReviewRunId,
  SandboxExecutionId,
  WorkflowRunId,
} from '@patchplane/domain/ids'
import { getSourceControlWorker } from '@/env'
import { effectServerFnHandlers } from './effect-server-fn'
import { getWorkOSAuthRequest } from './workos-auth-request'
import { loadConfiguredConvexUrl } from './convex-url'

const DecisionComment = Schema.String.check(Schema.isMaxLength(4_000))
const DecisionOverrideReason = Schema.String.check(Schema.isMaxLength(4_000))
const DecisionIdempotencyKey = Schema.String.check(Schema.isMaxLength(512))

const ReviewDecisionInput = Schema.Struct({
  workflowRunId: WorkflowRunId,
  sandboxExecutionId: SandboxExecutionId,
  candidatePatchSetId: CandidatePatchSetId,
  reviewRunId: ReviewRunId,
  policyDecisionId: PolicyDecisionId,
  status: Schema.Literals(['approved', 'rejected', 'changes-requested']),
  comment: DecisionComment,
  verificationOverrideReason: Schema.optional(DecisionOverrideReason),
  idempotencyKey: DecisionIdempotencyKey,
})

const recordHumanDecisionMutation = makeFunctionReference<
  'mutation',
  {
    workflowRunId: WorkflowRunId
    sandboxExecutionId: SandboxExecutionId
    candidatePatchSetId: CandidatePatchSetId
    reviewRunId: ReviewRunId
    policyDecisionId: PolicyDecisionId
    status: typeof ReviewDecisionInput.Type.status
    comment: string
    verificationOverrideReason?: string
    idempotencyKey?: string
  },
  unknown
>('workflowStarts:recordHumanDecision')

const RecordedHumanDecision = Schema.Struct({
  id: HumanDecisionId,
  status: ReviewDecisionInput.fields.status,
})

const SourceControlPublishDecisionResponse = Schema.Struct({
  ok: Schema.Boolean,
  traceId: Schema.String,
  error: Schema.optional(Schema.String),
  publications: Schema.optional(Schema.Array(Schema.Unknown)),
})

type SourceControlPublishDecisionResponse = Schema.Schema.Type<
  typeof SourceControlPublishDecisionResponse
>

class ReviewDecisionError extends Schema.TaggedError<ReviewDecisionError>()(
  'ReviewDecisionError',
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export function decisionPublicationRequest(input: {
  readonly traceId: string
  readonly workflowRunId: WorkflowRunId
  readonly humanDecisionId: HumanDecisionId
}) {
  return {
    traceId: input.traceId,
    workflowRunId: input.workflowRunId,
    humanDecisionId: input.humanDecisionId,
  }
}

const publishDecisionToSourceControl = Effect.fnUntraced(function* (input: {
  readonly traceId: string
  readonly workflowRunId: WorkflowRunId
  readonly humanDecisionId: HumanDecisionId
}) {
  const fetcher = yield* Effect.tryPromise({
    try: () => getSourceControlWorker(),
    catch: () =>
      new ReviewDecisionError({
        message: 'Decision publication request failed',
      }),
  })
  const client = Cloudflare.toHttpClient(
    Cloudflare.fromCloudflareFetcher(fetcher),
  )
  return yield* client
    .execute(
      HttpClientRequest.post(
        'https://source-control-worker/internal/decision/publish',
        {
          headers: { 'content-type': 'application/json' },
          body: HttpBody.text(
            JSON.stringify(decisionPublicationRequest(input)),
            'application/json',
          ),
        },
      ),
    )
    .pipe(
      Effect.flatMap((workerResponse) => workerResponse.json),
      Effect.flatMap(
        Schema.decodeUnknownEffect(SourceControlPublishDecisionResponse),
      ),
      Effect.mapError(
        () =>
          new ReviewDecisionError({
            message: 'Decision publication request failed',
          }),
      ),
    )
})

const submitReviewDecisionHandlers = effectServerFnHandlers({
  method: 'POST',
  input: ReviewDecisionInput,
  operation: 'submitReviewDecisionServerFn',
  effect: (input, context) =>
    Effect.gen(function* () {
      const comment = input.comment.trim()
      if (comment.length === 0) {
        return yield* new ReviewDecisionError({
          message: 'Decision comment required',
        })
      }

      const authRequest = yield* getWorkOSAuthRequest().pipe(
        Effect.mapError(
          (cause) =>
            new ReviewDecisionError({
              message: 'Unable to load the authenticated session',
              cause,
            }),
        ),
      )
      const convexUrl = yield* loadConfiguredConvexUrl().pipe(
        Effect.mapError(
          (cause) =>
            new ReviewDecisionError({
              message: 'Review decision configuration is invalid',
              cause,
            }),
        ),
      )
      const decision = yield* withCriticalPathTransition(
        {
          traceId: context.traceId,
          workflowRunId: input.workflowRunId,
          operation: 'submitReviewDecisionServerFn.recordHumanDecision',
          stage: criticalPathStages.humanDecision,
        },
        convexMutation({
          url: convexUrl.toString().replace(/\/$/, ''),
          ...(authRequest.accessToken === undefined
            ? {}
            : { auth: authRequest.accessToken }),
          reference: recordHumanDecisionMutation,
          args: {
            workflowRunId: input.workflowRunId,
            sandboxExecutionId: input.sandboxExecutionId,
            candidatePatchSetId: input.candidatePatchSetId,
            reviewRunId: input.reviewRunId,
            policyDecisionId: input.policyDecisionId,
            status: input.status,
            comment,
            ...(input.verificationOverrideReason === undefined
              ? {}
              : {
                  verificationOverrideReason:
                    input.verificationOverrideReason.trim(),
                }),
            idempotencyKey: input.idempotencyKey,
          },
          catch: () =>
            new ReviewDecisionError({
              message: 'Unable to record the review decision',
            }),
        }).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(RecordedHumanDecision)),
        ),
      )
      const response = yield* publishDecisionToSourceControl({
        traceId: context.traceId,
        workflowRunId: input.workflowRunId,
        humanDecisionId: decision.id,
      })

      if (!response.ok) {
        return yield* new ReviewDecisionError({
          message: response.error ?? 'Decision publication failed',
        })
      }

      return { decision, publications: response.publications ?? [] }
    }),
  success: (result: {
    readonly decision: {
      readonly id: string
      readonly status: typeof ReviewDecisionInput.Type.status
    }
    readonly publications: ReadonlyArray<unknown>
  }) => result,
  failure: (cause: unknown) => ({
    error: publicErrorMessage(cause, 'Review decision failed'),
  }),
})

export const submitReviewDecisionServerFn = createServerFn({
  method: 'POST',
  strict: false,
})
  .validator(submitReviewDecisionHandlers.validator)
  .handler(submitReviewDecisionHandlers.handler)
