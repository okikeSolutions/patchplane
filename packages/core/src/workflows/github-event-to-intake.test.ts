import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  makeGitHubAppActorId,
  makeSystemWorkspaceId,
} from '@patchplane/domain/ids'
import { GitHubEventToWorkflowIntake } from './github-event-to-intake'

describe('GitHubEventToWorkflowIntake', () => {
  it.effect('maps GitHub issue events to generic workflow intake', () =>
    Effect.gen(function* () {
      const intake = yield* GitHubEventToWorkflowIntake(
        {
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
        },
        {
          actor: {
            id: makeGitHubAppActorId('123'),
            displayName: 'GitHub App installation 123',
          },
          workspaceId: makeSystemWorkspaceId('workspace-1'),
          traceId: 'trace-1',
        },
      )

      expect(intake.actor.id).toBe('github-app:123')
      expect(intake.workspaceId).toBe('system:workspace-1')
      expect(intake.traceId).toBe('trace-1')
      expect(intake.source).toBe('external')
      expect(intake.externalRef).toMatchObject({
        provider: 'github',
        eventKind: 'github.issue.opened',
        repositoryExternalId: '456',
        issueExternalId: '789',
        issueNumber: 7,
        senderLogin: 'octocat',
      })
    }),
  )
})
