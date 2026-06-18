import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { makeGitHubAppActorId, makePromptRequestId, makeSystemWorkspaceId, makeWorkflowRunId } from '@patchplane/domain/ids'
import { SourceControlService } from '../services/source-control-service'
import { PrepareRepositoryClone } from './prepare-repository-clone'

const SourceControlTestLayer = Layer.succeed(
  SourceControlService,
  SourceControlService.of({
    verifyRepositoryAccess: () => Effect.die('unused'),
    createIssueComment: () => Effect.die('unused'),
    createRepositoryCloneCredentials: (input) =>
      Effect.succeed({
        username: 'x-access-token',
        password: `${input.provider}:${input.installationId}:${input.repositoryExternalId}`,
      }),
  }),
)

describe('PrepareRepositoryClone', () => {
  it.effect('prepares GitHub clone URL and installation credentials', () =>
    Effect.gen(function* () {
      const clone = yield* PrepareRepositoryClone({
        promptRequest: {
          id: makePromptRequestId('prompt-1'),
          workspaceId: makeSystemWorkspaceId('workspace-1'),
          actorId: makeGitHubAppActorId('123'),
          traceId: 'trace-1',
          source: 'external',
          prompt: 'prompt',
          externalRef: {
            provider: 'github',
            deliveryId: 'delivery-1',
            eventKind: 'github.issue.opened',
            repositoryProvider: 'github',
            repositoryInstallationId: '123',
            repositoryOwner: 'owner',
            repositoryName: 'repo',
            repositoryFullName: 'owner/repo',
            repositoryExternalId: '456',
          },
          status: 'created',
          createdAt: 1,
        },
        workflowRun: {
          id: makeWorkflowRunId('run-1'),
          promptRequestId: makePromptRequestId('prompt-1'),
          workspaceId: makeSystemWorkspaceId('workspace-1'),
          traceId: 'trace-1',
          status: 'queued',
          createdAt: 1,
        },
      })

      expect(clone).toEqual({
        repositoryUrl: 'https://github.com/owner/repo.git',
        repositoryFullName: 'owner/repo',
        gitUsername: 'x-access-token',
        gitPassword: 'github:123:456',
      })
    }).pipe(Effect.provide(SourceControlTestLayer)),
  )
})
