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

function configuredConvexUrl() {
  const value = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL
  if (value === undefined || value.trim().length === 0) {
    throw new Error('CONVEX_URL or VITE_CONVEX_URL is required')
  }
  return value.replace(/\/$/, '')
}

async function authorizeWorkflowRun(workflowRunId: string, authToken?: string) {
  const convex = new ConvexHttpClient(configuredConvexUrl())
  if (authToken !== undefined) convex.setAuth(authToken)
  await convex.query(authorizeRuntimeControl, { workflowRunId })
}

function validateControlInput(input: typeof RuntimeControlInput.Type) {
  if ((input.operation === 'steer' || input.operation === 'followUp') && input.message?.trim()) return undefined
  if (input.operation === 'abort' || input.operation === 'terminate') return undefined
  return 'Message is required for steer and follow-up runtime controls'
}

async function sendRuntimeControl(input: typeof RuntimeControlInput.Type): Promise<SourceControlRuntimeControlResponse> {
  const client = Cloudflare.toHttpClient(
    Cloudflare.fromCloudflareFetcher(await getSourceControlWorker()),
  )
  const { patchPlaneRuntime } = await import('@/effect/runtime')
  return await patchPlaneRuntime.runPromise(
    client.execute(
      HttpClientRequest.post('https://source-control-worker/internal/runtime/control', {
        headers: {
          'content-type': 'application/json',
        },
        body: HttpBody.text(JSON.stringify(input), 'application/json'),
      }),
    ).pipe(
      Effect.flatMap((workerResponse) => workerResponse.json),
      Effect.flatMap(Schema.decodeUnknownEffect(SourceControlRuntimeControlResponse)),
    ),
  )
}

export const controlRuntimeSessionServerFn = effectServerFn({
  method: 'POST',
  input: RuntimeControlInput,
  operation: 'controlRuntimeSessionServerFn',
  effect: (input) =>
    Effect.promise(async () => {
      const validationError = validateControlInput(input)
      if (validationError !== undefined) {
        return { status: 'missing_message' as const }
      }

      const authRequest = await getWorkOSAuthRequest()
      await authorizeWorkflowRun(input.workflowRunId, authRequest.accessToken)
      const response = await sendRuntimeControl(input)

      if (!response.ok) {
        throw new Error(response.error ?? 'Runtime control failed')
      }

      return { status: response.status ?? 'no_active_session' as const }
    }),
  success: (result: RuntimeControlResult) => result,
  failure: (cause: unknown) => ({
    error: publicErrorMessage(cause, 'Runtime control failed'),
  }),
})
