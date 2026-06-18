import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import {
  makeGitHubAppActorId,
  makePromptRequestId,
  makeSystemWorkspaceId,
  makeWorkflowRunId,
} from '@patchplane/domain/ids'
import { StorageService } from '../services/storage-service'
import { SourceControlService } from '../services/source-control-service'
import { StartWorkflowFromIntake } from './start-workflow-from-intake'

let verifiedRepository: unknown

const TestStorageLayer = Layer.succeed(
  StorageService,
  StorageService.of({
    listRecentWorkflowStarts: () => Effect.succeed([]),
    recordSandboxExecution: () => Effect.die('unused'),
    recordRuntimeEvents: () => Effect.die('unused'),
    createWorkflowFromPrompt: () => Effect.die('unused'),
    createWorkflowFromIntake: (input) =>
      Effect.succeed({
        promptRequest: {
          id: makePromptRequestId('prompt-1'),
          workspaceId: input.workspaceId,
          actorId: input.actor.id,
          traceId: input.traceId,
          source: input.source,
          prompt: input.prompt,
          ...(input.externalRef === undefined ? {} : { externalRef: input.externalRef }),
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

const TestSourceControlLayer = Layer.succeed(
  SourceControlService,
  SourceControlService.of({
    verifyRepositoryAccess: (input) =>
      Effect.sync(() => {
        verifiedRepository = input
        return {
          provider: input.provider,
          ...(input.installationId === undefined
            ? {}
            : { installationId: input.installationId }),
          owner: input.owner,
          name: input.name,
          fullName: `${input.owner}/${input.name}`,
        }
      }),
    createIssueComment: () => Effect.die('unused'),
    createRepositoryCloneCredentials: () => Effect.die('unused'),
  }),
)

describe('StartWorkflowFromIntake', () => {
  it.effect('verifies repository access before storing external workflow intake', () =>
    Effect.gen(function* () {
      verifiedRepository = undefined

      const result = yield* StartWorkflowFromIntake({
        actor: {
          id: makeGitHubAppActorId('123'),
          displayName: 'GitHub App installation 123',
        },
        workspaceId: makeSystemWorkspaceId('workspace-1'),
        source: 'external',
        traceId: 'trace-1',
        prompt: 'Fix the bug',
        externalRef: {
          provider: 'github',
          deliveryId: 'delivery-1',
          eventKind: 'github.issue.opened',
          repositoryProvider: 'github',
          repositoryInstallationId: '123',
          repositoryExternalId: '456',
          repositoryOwner: 'patchplane',
          repositoryName: 'demo',
          repositoryFullName: 'patchplane/demo',
          issueExternalId: '789',
          issueNumber: 7,
        },
      })

      expect(verifiedRepository).toEqual({
        provider: 'github',
        installationId: '123',
        owner: 'patchplane',
        name: 'demo',
      })
      expect(result.promptRequest.externalRef?.provider).toBe('github')
      expect(result.workflowRun.status).toBe('queued')
    }).pipe(Effect.provide(Layer.merge(TestStorageLayer, TestSourceControlLayer))),
  )
})
