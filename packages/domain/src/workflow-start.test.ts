import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit } from 'effect'
import { decodeWorkflowStart } from './workflow-start'

describe('domain schemas', () => {
  it.effect('decodes a valid WorkflowStart payload', () =>
    Effect.gen(function* () {
      const value = yield* decodeWorkflowStart({
        promptRequest: {
          id: 'prompt-1',
          workspaceId: 'workspace-1',
          actorId: 'actor-1',
          traceId: 'trace-1',
          source: 'dev',
          prompt: 'Fix the bug',
          status: 'created',
          createdAt: 1,
        },
        workflowRun: {
          id: 'workflow-1',
          promptRequestId: 'prompt-1',
          workspaceId: 'workspace-1',
          traceId: 'trace-1',
          status: 'queued',
          createdAt: 1,
        },
      })

      expect(value.workflowRun.status).toBe('queued')
      expect(value.promptRequest.source).toBe('dev')
    }),
  )

  it.effect('rejects an invalid WorkflowStart payload', () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        decodeWorkflowStart({
          promptRequest: {
            id: 'prompt-1',
            workspaceId: 'workspace-1',
            actorId: 'actor-1',
            traceId: 'trace-1',
            source: 'not-a-source',
            prompt: 'Fix the bug',
            status: 'created',
            createdAt: 1,
          },
          workflowRun: {
            id: 'workflow-1',
            promptRequestId: 'prompt-1',
            workspaceId: 'workspace-1',
            traceId: 'trace-1',
            status: 'queued',
            createdAt: 1,
          },
        }),
      )

      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )
})
