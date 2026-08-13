import * as Cloudflare from 'alchemy/Cloudflare/Bridge'
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { Effect, Schema } from 'effect'
import * as HttpBody from 'effect/unstable/http/HttpBody'
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest'
import { publicErrorMessage } from '@patchplane/domain/errors'
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
import { effectServerFn } from './effect-server-fn'
import { getWorkOSAuthRequest } from './workos-auth-request'
import { loadConfiguredConvexUrl } from './convex-url'

const ReviewDecisionInput = Schema.Struct({
  workflowRunId: WorkflowRunId,
  sandboxExecutionId: SandboxExecutionId,
  candidatePatchSetId: CandidatePatchSetId,
  reviewRunId: ReviewRunId,
  policyDecisionId: PolicyDecisionId,
  status: Schema.Literals(['approved', 'rejected', 'changes-requested']),
  comment: Schema.String,
  verificationOverrideReason: Schema.optional(Schema.String),
  idempotencyKey: Schema.String,
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

class ReviewDecisionError extends Schema.Error<ReviewDecisionError>(
  'ReviewDecisionError',
)({
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

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
  return yield* Effect.tryPromise({
    try: async () => {
      const client = Cloudflare.toHttpClient(
        Cloudflare.fromCloudflareFetcher(await getSourceControlWorker()),
      )
      const { patchPlaneRuntime } = await import('@/effect/runtime')
      return await patchPlaneRuntime.runPromise(
        client
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
          ),
      )
    },
    catch: () =>
      new ReviewDecisionError({
        message: 'Decision publication request failed',
      }),
  })
})

export const submitReviewDecisionServerFn = effectServerFn({
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

      const authRequest = yield* Effect.tryPromise({
        try: () => getWorkOSAuthRequest(),
        catch: () =>
          new ReviewDecisionError({
            message: 'Unable to load the authenticated session',
          }),
      })
      const convexUrl = yield* loadConfiguredConvexUrl().pipe(
        Effect.mapError(
          (cause) =>
            new ReviewDecisionError({
              message: 'Review decision configuration is invalid',
              cause,
            }),
        ),
      )
      const convex = new ConvexHttpClient(
        convexUrl.toString().replace(/\/$/, ''),
      )
      if (authRequest.accessToken !== undefined)
        convex.setAuth(authRequest.accessToken)

      const decision = yield* withCriticalPathTransition(
        {
          traceId: context.traceId,
          workflowRunId: input.workflowRunId,
          operation: 'submitReviewDecisionServerFn.recordHumanDecision',
          stage: criticalPathStages.humanDecision,
        },
        Effect.tryPromise({
          try: () =>
            convex.mutation(recordHumanDecisionMutation, {
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
            }),
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
