import { describe, expect, it } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import { GitHubNormalizedWorkflowEvent } from '@patchplane/domain/github'
import {
  makeGitHubAppActorId,
  makeSystemWorkspaceId,
} from '@patchplane/domain/ids'
import { GitHubEventToWorkflowIntake } from './github-event-to-intake'

const decodeEvent = Schema.decodeUnknownEffect(GitHubNormalizedWorkflowEvent)

describe('GitHubEventToWorkflowIntake', () => {
  it.effect('rejects issue intake without an authoritative commit SHA', () =>
    Effect.gen(function* () {
      const event = yield* decodeEvent({
        kind: 'github.issue.opened',
        deliveryId: 'delivery-1',
        installationId: 123,
        owner: 'patchplane',
        repo: 'demo',
        repositoryId: 456,
        issueId: 789,
        issueNumber: 7,
        title: 'Fix auth callback',
        prompt: 'Fix auth callback\n\nDetails',
        url: 'https://github.com/patchplane/demo/issues/7',
        sender: 'octocat',
      })
      const error = yield* GitHubEventToWorkflowIntake(event, {
        actor: {
          id: makeGitHubAppActorId('123'),
          displayName: 'GitHub App installation 123',
        },
        workspaceId: makeSystemWorkspaceId('workspace-1'),
        traceId: 'trace-1',
      }).pipe(Effect.flip)

      expect(error.message).toContain('authoritative pull request head SHA')
    }),
  )

  it.effect(
    'maps GitHub pull request events to workflow intake with PR provenance',
    () =>
      Effect.gen(function* () {
        const headSha = 'abc123abc123abc123abc123abc123abc123abcd'
        const event = yield* decodeEvent({
          kind: 'github.pull_request.synchronize',
          deliveryId: 'delivery-pr-1',
          installationId: 123,
          owner: 'patchplane',
          repo: 'demo',
          repositoryId: 456,
          pullRequestId: 987,
          pullRequestNumber: 12,
          title: 'Fix auth callback',
          prompt: 'Fix auth callback\n\nUpdated branch.',
          headSha,
          headRef: 'feature/auth-callback',
          baseRef: 'main',
          url: 'https://github.com/patchplane/demo/pull/12',
          sender: 'octocat',
        })
        const intake = yield* GitHubEventToWorkflowIntake(event, {
          actor: {
            id: makeGitHubAppActorId('123'),
            displayName: 'GitHub App installation 123',
          },
          workspaceId: makeSystemWorkspaceId('workspace-1'),
          traceId: 'trace-pr-1',
        })

        expect(intake.externalRef).toMatchObject({
          provider: 'github',
          eventKind: 'github.pull_request.synchronize',
          repositoryExternalId: '456',
          issueNumber: 12,
          issueTitle: 'Fix auth callback',
          pullRequestExternalId: '987',
          pullRequestNumber: 12,
          pullRequestHeadSha: headSha,
          pullRequestHeadRef: 'feature/auth-callback',
          pullRequestBaseRef: 'main',
          senderLogin: 'octocat',
        })
      }),
  )
})
