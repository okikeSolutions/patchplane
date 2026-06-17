import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { GitHubWebhookService } from '../services/github-webhook-service'
import { IngestGitHubWebhook } from './ingest-github-webhook'

const payload = {
  action: 'opened',
  installation: { id: 123 },
  repository: { id: 456, owner: { login: 'patchplane' }, name: 'demo' },
  issue: {
    id: 789,
    number: 7,
    title: 'Fix auth callback',
    body: 'The callback route fails intermittently.',
    html_url: 'https://github.com/patchplane/demo/issues/7',
  },
  sender: { login: 'octocat' },
}

const GitHubWebhookLayer = Layer.succeed(
  GitHubWebhookService,
  GitHubWebhookService.of({
    verifyWebhook: (input) =>
      Effect.succeed({
        deliveryId: input.deliveryId,
        eventName: input.eventName,
        payload,
      }),
  }),
)

describe('IngestGitHubWebhook', () => {
  it.effect('normalizes issues.opened webhook payloads', () =>
    Effect.gen(function* () {
      const event = yield* IngestGitHubWebhook({
        deliveryId: 'delivery-1',
        eventName: 'issues',
        signature: 'sha256=test',
        payload: JSON.stringify(payload),
      })

      expect(event).toMatchObject({
        kind: 'github.issue.opened',
        deliveryId: 'delivery-1',
        installationId: 123,
        owner: 'patchplane',
        repo: 'demo',
        repositoryId: 456,
        issueId: 789,
        issueNumber: 7,
        title: 'Fix auth callback',
        sender: 'octocat',
      })
      expect(event.prompt).toContain('Fix auth callback')
      expect(event.prompt).toContain('The callback route fails intermittently.')
    }).pipe(Effect.provide(GitHubWebhookLayer)),
  )
})
