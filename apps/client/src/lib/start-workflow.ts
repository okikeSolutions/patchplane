import { createServerFn } from '@tanstack/react-start'
import { devActor, devWorkspace } from '@patchplane/core/dev/context'
import { StartWorkflowFromPrompt } from '@patchplane/core/workflows/start-workflow-from-prompt'
import { Effect } from 'effect'
import * as z from 'zod'
import { patchPlaneRuntime } from '@/effect/runtime'

const startWorkflowInput = z.object({
  prompt: z.string().min(1),
})

export const startWorkflowServerFn = createServerFn({ method: 'POST' })
  .validator(startWorkflowInput)
  .handler(async ({ data }) => {
    const traceId = crypto.randomUUID()

    return patchPlaneRuntime.runPromise(
      StartWorkflowFromPrompt({
        actor: devActor,
        workspace: devWorkspace,
        source: 'dev',
        traceId,
        prompt: data.prompt,
      }).pipe(
        Effect.annotateLogs({ traceId, entrypoint: 'startWorkflowServerFn' }),
        Effect.annotateSpans({ traceId, entrypoint: 'startWorkflowServerFn' }),
        Effect.withLogSpan('startWorkflowServerFn'),
      ),
    )
  })
