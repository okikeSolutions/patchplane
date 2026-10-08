import * as Cloudflare from 'alchemy/Cloudflare/Bridge'
import { createServerFn } from '@tanstack/react-start'
import { makeFunctionReference } from 'convex/server'
import { Effect, Schema } from 'effect'
import * as HttpBody from 'effect/http/HttpBody'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import { publicErrorMessage } from '@patchplane/domain/errors'
import { convexMutation } from '@patchplane/plugins/convex/http-client'
import { SandboxExecutionId, WorkflowRunId } from '@patchplane/domain/ids'
import {
  criticalPathStages,
  withCriticalPathTransition,
} from '@patchplane/core/services/telemetry-service'
import { getSourceControlWorker } from '@/env'
import { effectServerFnHandlers } from './effect-server-fn'
import { getWorkOSAuthRequest } from './workos-auth-request'
import { loadConfiguredConvexUrl } from './convex-url'

class RerunWorkflowError extends Schema.TaggedError<RerunWorkflowError>()(
  'RerunWorkflowError',
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

const RerunWorkflowInput = Schema.Struct({
  parentWorkflowRunId: WorkflowRunId,
  reason: Schema.String.check(Schema.isMaxLength(4_000)),
  idempotencyKey: Schema.String.check(Schema.isMaxLength(512)),
})

const createRerunMutation = makeFunctionReference<
  'mutation',
  typeof RerunWorkflowInput.Type,
  unknown
>('workflowStarts:createRerun')

const RerunWorkflowStart = Schema.Struct({
  workflowRun: Schema.Struct({ id: WorkflowRunId }),
})

const RerunExecutionResponse = Schema.Struct({
  ok: Schema.Boolean,
  traceId: Schema.String,
  workflowRunId: Schema.optional(WorkflowRunId),
  sandboxExecutionId: Schema.optional(SandboxExecutionId),
  error: Schema.optional(Schema.String),
})

const rerunWorkflowHandlers = effectServerFnHandlers({
  method: 'POST',
  input: RerunWorkflowInput,
  operation: 'rerunWorkflowServerFn',
  effect: (input, context) =>
    Effect.gen(function* () {
      const reason = input.reason.trim()
      if (reason.length === 0) {
        return yield* new RerunWorkflowError({
          message: 'Rerun reason required',
        })
      }

      const authRequest = yield* getWorkOSAuthRequest().pipe(
        Effect.mapError(
          (cause) =>
            new RerunWorkflowError({
              message: 'Unable to load the authenticated session',
              cause,
            }),
        ),
      )
      const convexUrl = yield* loadConfiguredConvexUrl().pipe(
        Effect.mapError(
          (cause) =>
            new RerunWorkflowError({
              message: 'Rerun workflow configuration is invalid',
              cause,
            }),
        ),
      )
      const workflowStart = yield* withCriticalPathTransition(
        {
          traceId: context.traceId,
          workflowRunId: input.parentWorkflowRunId,
          operation: 'rerunWorkflowServerFn.createRerun',
          stage: criticalPathStages.rerunCreated,
        },
        convexMutation({
          url: convexUrl.toString().replace(/\/$/, ''),
          ...(authRequest.accessToken === undefined
            ? {}
            : { auth: authRequest.accessToken }),
          reference: createRerunMutation,
          args: {
            parentWorkflowRunId: input.parentWorkflowRunId,
            reason,
            idempotencyKey: input.idempotencyKey,
          },
          catch: (cause) =>
            new RerunWorkflowError({
              message: `Unable to create rerun attempt: ${String(cause)}`,
            }),
        }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(RerunWorkflowStart))),
      )

      const dispatchFallback = {
        ok: false as const,
        traceId: context.traceId,
        error:
          'The child attempt was created, but execution dispatch could not be confirmed.',
      }
      const response = yield* Effect.gen(function* () {
        const fetcher = yield* Effect.tryPromise({
          try: () => getSourceControlWorker(),
          catch: () =>
            new RerunWorkflowError({ message: dispatchFallback.error }),
        })
        const client = Cloudflare.toHttpClient(
          Cloudflare.fromCloudflareFetcher(fetcher),
        )
        return yield* client
          .execute(
            HttpClientRequest.post(
              'https://source-control-worker/internal/workflow/rerun',
              {
                headers: { 'content-type': 'application/json' },
                body: HttpBody.text(
                  JSON.stringify({
                    traceId: context.traceId,
                    workflowRunId: workflowStart.workflowRun.id,
                  }),
                  'application/json',
                ),
              },
            ),
          )
          .pipe(
            Effect.flatMap((workerResponse) => workerResponse.json),
            Effect.flatMap(Schema.decodeUnknownEffect(RerunExecutionResponse)),
          )
      }).pipe(Effect.orElseSucceed(() => dispatchFallback))

      return {
        workflowRunId: workflowStart.workflowRun.id,
        ...('sandboxExecutionId' in response
          ? { sandboxExecutionId: response.sandboxExecutionId }
          : {}),
        ...(!response.ok && response.error !== undefined
          ? { dispatchError: response.error }
          : {}),
      }
    }),
  success: (result: {
    readonly workflowRunId: WorkflowRunId
    readonly sandboxExecutionId?: SandboxExecutionId
    readonly dispatchError?: string
  }) => result,
  failure: (cause: unknown) => ({
    error: publicErrorMessage(cause, 'Workflow rerun failed'),
  }),
})

export const rerunWorkflowServerFn = createServerFn({
  method: 'POST',
  strict: false,
})
  .validator(rerunWorkflowHandlers.validator)
  .handler(rerunWorkflowHandlers.handler)
