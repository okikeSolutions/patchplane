import { describe, expect, test } from 'bun:test'
import { Effect, Schema } from 'effect'
import {
  GitHubAppAuthService,
  GitHubCheckRunPublicationSchema,
  GitHubIssueCommentPromptSourceSchema,
  GitHubWebhookReconciliationStateSchema,
  PromptRequestCommandSchema,
} from '../src/index'

const decodePromptRequestCommand = Schema.decodeUnknownSync(
  PromptRequestCommandSchema,
)
const decodeGitHubCheckRunPublication = Schema.decodeUnknownSync(
  GitHubCheckRunPublicationSchema,
)
const decodeGitHubIssueCommentPromptSource = Schema.decodeUnknownSync(
  GitHubIssueCommentPromptSourceSchema,
)
const decodeGitHubWebhookReconciliationState = Schema.decodeUnknownSync(
  GitHubWebhookReconciliationStateSchema,
)

describe('domain contracts', () => {
  test('decodes a prompt request command from a GitHub issue comment source', () => {
    const command = decodePromptRequestCommand({
      kind: 'prompt_request.create',
      projectId: 'project_123',
      executionTargetId: 'github.issue_comment',
      policyBundleId: 'default',
      createdByUserId: 'octocat',
      prompt: 'Fix the failing test',
      scope: {
        repoUrl: 'https://github.com/acme/repo',
        baseBranch: 'main',
        targetBranch: 'patchplane/fix-test',
        includePaths: ['src'],
        excludePaths: ['dist'],
        intent: 'fix',
      },
      source: {
        kind: 'github.issue_comment',
        deliveryId: 'delivery-1',
        externalInstallationId: 101,
        externalRepositoryId: 202,
        externalRepositoryNodeId: 'R_kgDOG123',
        repositoryFullName: 'acme/repo',
        issueNumber: 42,
        commentId: 99,
        actorLogin: 'octocat',
        command: '/patchplane fix the test',
      },
    })

    expect(command.source.kind).toBe('github.issue_comment')
    expect(command.scope.targetBranch).toBe('patchplane/fix-test')
  })

  test('rejects malformed GitHub issue comment prompt sources', () => {
    expect(() =>
      decodeGitHubIssueCommentPromptSource({
        kind: 'github.issue_comment',
        deliveryId: 'delivery-1',
        externalInstallationId: 101,
        externalRepositoryId: 202,
        externalRepositoryNodeId: 'R_kgDOG123',
        issueNumber: 42,
        commentId: 99,
        actorLogin: 'octocat',
        command: '/patchplane fix the test',
      }),
    ).toThrow()
  })

  test('rejects unsupported GitHub check run statuses', () => {
    expect(() =>
      decodeGitHubCheckRunPublication({
        kind: 'check_run',
        externalInstallationId: 101,
        owner: 'acme',
        repo: 'repo',
        name: 'PatchPlane',
        headSha: 'abc123',
        status: 'done',
        summary: 'Finished',
      }),
    ).toThrow()
  })

  test('decodes webhook reconciliation state records', () => {
    const state = decodeGitHubWebhookReconciliationState({
      id: 'reconciliation_1',
      key: 'app_webhook_redelivery',
      lastSuccessfulRedeliveryStartedAt: 1_710_000_000_000,
      lastRunStartedAt: 1_710_000_010_000,
      lastRunCompletedAt: 1_710_000_020_000,
      lastRunStatus: 'completed',
      updatedAt: 1_710_000_020_000,
    })

    expect(state.lastRunStatus).toBe('completed')
    expect(state.key).toBe('app_webhook_redelivery')
  })

  test('resolves GitHub services through Effect tags', async () => {
    const fakeGitHubAppAuth = {
      name: 'fake-github-app-auth',
      getInstallationToken: () =>
        Effect.succeed({
          token: 'installation-token',
          expiresAt: '2026-03-25T00:00:00.000Z',
        }),
      resolveInstallationScope: () =>
        Effect.succeed({
          externalInstallationId: 101,
          accountLogin: 'acme',
          accountType: 'Organization' as const,
          targetType: 'Organization' as const,
          repositorySelection: 'selected' as const,
          permissions: {
            issues: 'read',
            metadata: 'read',
          },
          repositories: [],
          syncedAt: 1_710_000_000_000,
        }),
    }

    const program = Effect.gen(function* () {
      const auth = yield* GitHubAppAuthService
      return yield* auth.getInstallationToken(101)
    })

    const token = await Effect.runPromise(
      Effect.provideService(program, GitHubAppAuthService, fakeGitHubAppAuth),
    )

    expect(token.token).toBe('installation-token')
  })
})
