import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { makeGitHubAppActorId, makePromptRequestId, makeWorkOSWorkspaceId, makeWorkflowRunId } from '@patchplane/domain/ids'
import { SourceControlService } from '../services/source-control-service'
import { PublishSandboxResultToSource } from './publish-sandbox-result-to-source'

interface CapturedComment {
  provider: string
  installationId?: string
  owner: string
  name: string
  issueNumber: number
  body: string
}

describe('PublishSandboxResultToSource', () => {
  it.effect('publishes PR trust reports through GitHub issue comments using the PR number', () =>
    Effect.gen(function* () {
      const comments: Array<CapturedComment> = []
      const sourceControlLayer = Layer.succeed(
        SourceControlService,
        SourceControlService.of({
          verifyRepositoryAccess: () => Effect.die('unused'),
          getInstallationAccount: () => Effect.die('unused'),
          listInstallationRepositories: () => Effect.die('unused'),
          createRepositoryCloneCredentials: () => Effect.die('unused'),
          createIssueComment: (input) =>
            Effect.sync(() => {
              comments.push(input)
            }),
        }),
      )

      const publication = yield* PublishSandboxResultToSource({
        workflowStart: {
          promptRequest: {
            id: makePromptRequestId('prompt-pr-1'),
            workspaceId: makeWorkOSWorkspaceId('org_123'),
            actorId: makeGitHubAppActorId('123'),
            traceId: 'trace-pr-1',
            source: 'external',
            prompt: 'Fix auth callback',
            externalRef: {
              provider: 'github',
              deliveryId: 'delivery-pr-1',
              eventKind: 'github.pull_request.synchronize',
              repositoryProvider: 'github',
              repositoryInstallationId: '123',
              repositoryExternalId: '456',
              repositoryOwner: 'patchplane',
              repositoryName: 'demo',
              repositoryFullName: 'patchplane/demo',
              issueNumber: 12,
              pullRequestExternalId: '987',
              pullRequestNumber: 12,
              pullRequestHeadSha: 'abc123',
              pullRequestHeadRef: 'feature/auth-callback',
              pullRequestBaseRef: 'main',
            },
            status: 'created',
            createdAt: 1,
          },
          workflowRun: {
            id: makeWorkflowRunId('run-pr-1'),
            promptRequestId: makePromptRequestId('prompt-pr-1'),
            workspaceId: makeWorkOSWorkspaceId('org_123'),
            traceId: 'trace-pr-1',
            status: 'queued',
            createdAt: 1,
          },
        },
        sandboxExecution: {
          id: 'sandbox-exec-pr-1',
          workflowRunId: makeWorkflowRunId('run-pr-1'),
          provider: 'daytona',
          sandboxId: 'sandbox-pr-1',
          command: 'bun test',
          status: 'succeeded',
          exitCode: 0,
          stdout: 'ok',
          startedAt: 1,
          completedAt: 2,
        },
      }).pipe(Effect.provide(sourceControlLayer))

      expect(publication).toEqual({ provider: 'github', issueNumber: 12 })
      expect(comments).toHaveLength(1)
      expect(comments[0]).toMatchObject({
        provider: 'github',
        installationId: '123',
        owner: 'patchplane',
        name: 'demo',
        issueNumber: 12,
      })
      expect(comments[0]?.body).toContain('## PatchPlane Patch Report')
      expect(comments[0]?.body).toContain('**Status:** verification passed')
      expect(comments[0]?.body).toContain('- Decision: pending human approval')
    }),
  )
})
