import { describe, expect, it } from '@effect/vitest'
import {
  makePromptRequestId,
  makeSystemActorId,
  makeSystemWorkspaceId,
  makeWorkflowRunId,
} from '@patchplane/domain/ids'
import { Effect, Layer } from 'effect'
import { StorageService } from '../services/storage-service'
import { ListRecentWorkflowStarts } from './list-recent-workflow-starts'

const TestStorageLayer = Layer.succeed(
  StorageService,
  StorageService.of({
    createWorkflowFromIntake: () => Effect.die('unused'),
    createWorkflowFromPrompt: () => Effect.die('unused'),
    recordSandboxExecution: () => Effect.die('unused'),
    recordRuntimeEvents: () => Effect.die('unused'),
    recordRuntimeSessionStarted: () => Effect.die('unused'),
    markRuntimeSessionStatus: () => Effect.die('unused'),
    getActiveRuntimeSession: () => Effect.die('unused'),
    recordEvidenceArtifact: () => Effect.die('unused'),
    getEvidenceArtifact: () => Effect.die('unused'),
    recordCandidatePatchSet: () => Effect.die('unused'),
    recordReviewRun: () => Effect.die('unused'),
    recordReviewFinding: () => Effect.die('unused'),
    recordPolicyDecision: () => Effect.die('unused'),
    recordPublicationResult: () => Effect.die('unused'),
    recordProvenanceEvent: () => Effect.die('unused'),
    listRecentWorkflowStarts: (input) =>
      Effect.succeed([
        {
          promptRequest: {
            id: makePromptRequestId('prompt-1'),
            workspaceId: input.workspaceId,
            actorId: makeSystemActorId('actor-1'),
            traceId: 'trace-1',
            source: 'dev',
            prompt: 'Fix the bug',
            status: 'created',
            createdAt: 1,
          },
          workflowRun: {
            id: makeWorkflowRunId('workflow-1'),
            promptRequestId: makePromptRequestId('prompt-1'),
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
        workspaceId: makeSystemWorkspaceId('workspace-1'),
        limit: 5,
      })

      expect(result).toHaveLength(1)
      expect(result[0]?.promptRequest.id).toBe('prompt-1')
      expect(result[0]?.workflowRun.status).toBe('queued')
    }).pipe(Effect.provide(TestStorageLayer)),
  )
})
