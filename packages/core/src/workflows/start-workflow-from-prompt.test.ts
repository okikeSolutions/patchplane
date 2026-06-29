import { describe, expect, it } from '@effect/vitest'
import {
  makePromptRequestId,
  makeSystemActorId,
  makeSystemWorkspaceId,
  makeWorkflowRunId,
} from '@patchplane/domain/ids'
import { Effect, Layer } from 'effect'
import { StorageService } from '../services/storage-service'
import { StartWorkflowFromPrompt } from './start-workflow-from-prompt'

const TestStorageLayer = Layer.succeed(
  StorageService,
  StorageService.of({
    listRecentWorkflowStarts: () => Effect.succeed([]),
    recordSandboxExecution: () => Effect.die('unused'),
    recordRuntimeEvents: () => Effect.die('unused'),
    recordRuntimeSessionStarted: () => Effect.die('unused'),
    markRuntimeSessionStatus: () => Effect.die('unused'),
    getActiveRuntimeSession: () => Effect.die('unused'),
    createWorkflowFromIntake: (input) =>
      Effect.succeed({
        promptRequest: {
          id: makePromptRequestId('prompt-1'),
          workspaceId: input.workspaceId,
          actorId: input.actor.id,
          traceId: input.traceId,
          source: input.source,
          prompt: input.prompt,
          status: 'created',
          createdAt: 1,
        },
        workflowRun: {
          id: makeWorkflowRunId('workflow-1'),
          promptRequestId: makePromptRequestId('prompt-1'),
          workspaceId: input.workspaceId,
          traceId: input.traceId,
          status: 'queued',
          createdAt: 1,
        },
      }),
    createWorkflowFromPrompt: (input) =>
      Effect.succeed({
        promptRequest: {
          id: makePromptRequestId('prompt-1'),
          workspaceId: input.workspaceId,
          actorId: input.actor.id,
          traceId: input.traceId,
          source: input.source,
          prompt: input.prompt,
          status: 'created',
          createdAt: 1,
        },
        workflowRun: {
          id: makeWorkflowRunId('workflow-1'),
          promptRequestId: makePromptRequestId('prompt-1'),
          workspaceId: input.workspaceId,
          traceId: input.traceId,
          status: 'queued',
          createdAt: 1,
        },
      }),
  }),
)

describe('StartWorkflowFromPrompt', () => {
  it.effect('creates a workflow through StorageService', () =>
    Effect.gen(function* () {
      const result = yield* StartWorkflowFromPrompt({
        actor: {
          id: makeSystemActorId('actor-1'),
          displayName: 'Actor One',
        },
        workspace: {
          id: makeSystemWorkspaceId('workspace-1'),
          name: 'Workspace One',
        },
        source: 'dev',
        traceId: 'trace-1',
        prompt: 'Fix the bug',
      })

      expect(result.promptRequest.prompt).toBe('Fix the bug')
      expect(result.promptRequest.actorId).toBe('system:actor-1')
      expect(result.promptRequest.source).toBe('dev')
      expect(result.promptRequest.traceId).toBe('trace-1')
      expect(result.workflowRun.traceId).toBe('trace-1')
      expect(result.workflowRun.promptRequestId).toBe(result.promptRequest.id)
      expect(result.workflowRun.status).toBe('queued')
    }).pipe(Effect.provide(TestStorageLayer)),
  )
})
