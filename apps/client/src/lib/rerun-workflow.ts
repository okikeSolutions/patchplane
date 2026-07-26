import * as Cloudflare from 'alchemy/Cloudflare/Bridge'
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { Config, Effect, Schema } from 'effect'
import * as HttpBody from 'effect/unstable/http/HttpBody'
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest'
import { publicErrorMessage } from '@patchplane/domain/errors'
import { SandboxExecutionId, WorkflowRunId } from '@patchplane/domain/ids'
import { getSourceControlWorker } from '@/env'
import { effectServerFn } from './effect-server-fn'
import { getWorkOSAuthRequest } from './workos-auth-request'

class RerunWorkflowError extends Schema.ErrorClass<RerunWorkflowError>('RerunWorkflowError')({
  message: Schema.String,
}) {}

const RerunWorkflowInput = Schema.Struct({
  parentWorkflowRunId: WorkflowRunId,
  reason: Schema.String,
  idempotencyKey: Schema.String,
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

const configuredConvexUrl = Config.nonEmptyString('CONVEX_URL').pipe(
  Config.orElse(() => Config.nonEmptyString('VITE_CONVEX_URL')),
  Config.map((value) => value.replace(/\/$/, '')),
)

export const rerunWorkflowServerFn = effectServerFn({
  method: 'POST',
  input: RerunWorkflowInput,
  operation: 'rerunWorkflowServerFn',
  effect: (input, context) => Effect.gen(function*() {
    const reason = input.reason.trim()
    if (reason.length === 0) {
      return yield* new RerunWorkflowError({ message: 'Rerun reason required' })
    }

    const authRequest = yield* Effect.tryPromise({
      try: () => getWorkOSAuthRequest(),
      catch: () => new RerunWorkflowError({ message: 'Unable to load the authenticated session' }),
    })
    const convex = new ConvexHttpClient(yield* configuredConvexUrl)
    if (authRequest.accessToken !== undefined) convex.setAuth(authRequest.accessToken)
    const workflowStart = yield* Effect.tryPromise({
      try: () => convex.mutation(createRerunMutation, {
        parentWorkflowRunId: input.parentWorkflowRunId,
        reason,
        idempotencyKey: input.idempotencyKey,
      }),
      catch: (cause) => new RerunWorkflowError({ message: `Unable to create rerun attempt: ${String(cause)}` }),
    }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(RerunWorkflowStart)))

    const dispatchFallback = {
      ok: false as const,
      traceId: context.traceId,
      error: 'The child attempt was created, but execution dispatch could not be confirmed.',
    }
    const response = yield* Effect.tryPromise({
      try: async () => {
        const client = Cloudflare.toHttpClient(
          Cloudflare.fromCloudflareFetcher(await getSourceControlWorker()),
        )
        const { patchPlaneRuntime } = await import('@/effect/runtime')
        return await patchPlaneRuntime.runPromise(
          client.execute(HttpClientRequest.post('https://source-control-worker/internal/workflow/rerun', {
            headers: { 'content-type': 'application/json' },
            body: HttpBody.text(JSON.stringify({
              traceId: context.traceId,
              workflowRunId: workflowStart.workflowRun.id,
            }), 'application/json'),
          })).pipe(
            Effect.flatMap((workerResponse) => workerResponse.json),
            Effect.flatMap(Schema.decodeUnknownEffect(RerunExecutionResponse)),
          ),
        )
      },
      catch: () => new RerunWorkflowError({ message: dispatchFallback.error }),
    }).pipe(Effect.orElseSucceed(() => dispatchFallback))

    return {
      workflowRunId: workflowStart.workflowRun.id,
      ...('sandboxExecutionId' in response ? { sandboxExecutionId: response.sandboxExecutionId } : {}),
      ...(!response.ok && response.error !== undefined ? { dispatchError: response.error } : {}),
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
