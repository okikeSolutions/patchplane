import * as Cloudflare from 'alchemy/Cloudflare/Bridge'
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { Effect, Schema } from 'effect'
import * as HttpBody from 'effect/unstable/http/HttpBody'
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest'
import { RuntimeControlInput, RuntimeControlResult } from '@patchplane/domain/runtime-control'
import { publicErrorMessage } from '@patchplane/domain/errors'
import { getSourceControlWorker } from '@/env'
import { effectServerFn } from './effect-server-fn'
import { getWorkOSAuthRequest } from './workos-auth-request'
import { loadConfiguredConvexUrl } from './convex-url'

const authorizeRuntimeControl = makeFunctionReference<
  'query',
  { workflowRunId: string },
  { workflowRunId: string; workspaceId: string; allowed: true }
>('workflowStarts:authorizeRuntimeControl')

const SourceControlRuntimeControlResponse = Schema.Struct({
  ok: Schema.Boolean,
  traceId: Schema.String,
  status: Schema.optional(RuntimeControlResult.fields.status),
  error: Schema.optional(Schema.String),
})

type SourceControlRuntimeControlResponse = Schema.Schema.Type<typeof SourceControlRuntimeControlResponse>

class RuntimeControlRequestError extends Schema.ErrorClass<RuntimeControlRequestError>('RuntimeControlRequestError')({
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

const authorizeWorkflowRun = Effect.fnUntraced(function*(workflowRunId: string, authToken?: string) {
  const convexUrl = yield* loadConfiguredConvexUrl().pipe(
    Effect.mapError((cause) => new RuntimeControlRequestError({
      message: 'Runtime control configuration is invalid',
      cause,
    })),
  )
  const convex = new ConvexHttpClient(convexUrl.toString().replace(/\/$/, ''))
  if (authToken !== undefined) convex.setAuth(authToken)
  yield* Effect.tryPromise({
    try: () => convex.query(authorizeRuntimeControl, { workflowRunId }),
    catch: (cause) => new RuntimeControlRequestError({
      message: 'Runtime control authorization failed',
      cause,
    }),
  })
})

function validateControlInput(input: RuntimeControlInput) {
  if ((input.operation === 'steer' || input.operation === 'followUp') && input.message?.trim()) return undefined
  if (input.operation === 'abort' || input.operation === 'terminate') return undefined
  return 'Message is required for steer and follow-up runtime controls'
}

const sendRuntimeControl = Effect.fnUntraced(function*(input: RuntimeControlInput) {
  const fetcher = yield* Effect.tryPromise({
    try: () => getSourceControlWorker(),
    catch: (cause) => new RuntimeControlRequestError({
      message: 'Source-control Worker binding is unavailable',
      cause,
    }),
  })
  const client = Cloudflare.toHttpClient(Cloudflare.fromCloudflareFetcher(fetcher))
  return yield* client.execute(
    HttpClientRequest.post('https://source-control-worker/internal/runtime/control', {
      headers: {
        'content-type': 'application/json',
      },
      body: HttpBody.text(JSON.stringify(input), 'application/json'),
    }),
  ).pipe(
    Effect.flatMap((workerResponse) => workerResponse.json),
    Effect.flatMap(Schema.decodeUnknownEffect(SourceControlRuntimeControlResponse)),
    Effect.mapError((cause) => new RuntimeControlRequestError({
      message: 'Runtime control request failed',
      cause,
    })),
  )
})

export const controlRuntimeSessionServerFn = effectServerFn({
  method: 'POST',
  input: RuntimeControlInput,
  operation: 'controlRuntimeSessionServerFn',
  effect: (input) => Effect.gen(function* () {
    const validationError = validateControlInput(input)
    if (validationError !== undefined) {
      return { status: 'missing_message' as const }
    }

    const authRequest = yield* Effect.tryPromise({
      try: () => getWorkOSAuthRequest(),
      catch: (cause) => new RuntimeControlRequestError({
        message: 'Unable to load the authenticated session',
        cause,
      }),
    })
    yield* authorizeWorkflowRun(input.workflowRunId, authRequest.accessToken)
    const response = yield* sendRuntimeControl(input)

    if (!response.ok) {
      return yield* new RuntimeControlRequestError({
        message: response.error ?? 'Runtime control failed',
      })
    }

    return { status: response.status ?? 'no_active_session' as const }
  }),
  success: (result: RuntimeControlResult) => result,
  failure: (cause: unknown) => ({
    error: publicErrorMessage(cause, 'Runtime control failed'),
  }),
})
