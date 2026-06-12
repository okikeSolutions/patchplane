import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { StorageService } from '../services/storage-service'
import { ListRecentWorkflowStarts } from './list-recent-workflow-starts'

const TestStorageLayer = Layer.succeed(
  StorageService,
  StorageService.of({
    createWorkflowFromPrompt: () => Effect.die('unused'),
    listRecentWorkflowStarts: (input) =>
      Effect.succeed([
        {
          promptRequest: {
            id: 'prompt-1',
            workspaceId: input.workspaceId,
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
            workspaceId: input.workspaceId,
            traceId: 'trace-1',
            status: 'queued',
            createdAt: 1,
          },
        },
      ]),
  }),
)

describe('ListRecentWorkflowStarts', () => {
  it.effect('reads recent workflow starts through StorageService', () =>
    Effect.gen(function* () {
      const result = yield* ListRecentWorkflowStarts({
        workspaceId: 'workspace-1',
        limit: 5,
      })

      expect(result).toHaveLength(1)
      expect(result[0]?.promptRequest.id).toBe('prompt-1')
      expect(result[0]?.workflowRun.status).toBe('queued')
    }).pipe(Effect.provide(TestStorageLayer)),
  )
})
