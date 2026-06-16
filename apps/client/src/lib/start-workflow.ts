import { createServerFn } from '@tanstack/react-start'
import { AuthRequestContext } from '@patchplane/core/services/auth-request-context'
import { StartAuthenticatedWorkflowFromPrompt } from '@patchplane/core/workflows/start-authenticated-workflow-from-prompt'
import { Effect, Schema } from 'effect'
import { patchPlaneRuntime } from '@/effect/runtime'
import { getWorkOSAuthRequest } from './workos-auth-request'

const StartWorkflowInput = Schema.Struct({
  prompt: Schema.String.check(Schema.isNonEmpty()),
})
const decodeStartWorkflowInput = Schema.decodeUnknownSync(StartWorkflowInput)

export const startWorkflowServerFn = createServerFn({ method: 'POST' })
  .validator(decodeStartWorkflowInput)
  .handler(async ({ data }) => {
    const traceId = crypto.randomUUID()
    const authRequest = await getWorkOSAuthRequest()

    return patchPlaneRuntime.runPromise(
      StartAuthenticatedWorkflowFromPrompt({
        source: 'app',
        traceId,
        prompt: data.prompt,
      }).pipe(
        Effect.provideService(AuthRequestContext, authRequest),
        Effect.annotateLogs({ traceId, entrypoint: 'startWorkflowServerFn' }),
        Effect.annotateSpans({ traceId, entrypoint: 'startWorkflowServerFn' }),
        Effect.withLogSpan('startWorkflowServerFn'),
      ),
    )
  })
