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

function gitHubWebhookLayer(payloadOverride: unknown = payload) {
  return Layer.succeed(
    GitHubWebhookService,
    GitHubWebhookService.of({
      verifyWebhook: (input) =>
        Effect.succeed({
          deliveryId: input.deliveryId,
          eventName: input.eventName,
          payload: payloadOverride,
        }),
    }),
  )
}

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
    }).pipe(Effect.provide(gitHubWebhookLayer())),
  )

  it.effect('normalizes pull_request.opened webhook payloads', () =>
    Effect.gen(function* () {
      const event = yield* IngestGitHubWebhook({
        deliveryId: 'delivery-pr-opened',
        eventName: 'pull_request',
        signature: 'sha256=test',
        payload: '{}',
      })

      expect(event).toMatchObject({
        kind: 'github.pull_request.opened',
        pullRequestId: 987,
        pullRequestNumber: 12,
        headSha: 'abc123',
      })
    }).pipe(Effect.provide(gitHubWebhookLayer({
      action: 'opened',
      installation: { id: 123 },
      repository: { id: 456, owner: { login: 'patchplane' }, name: 'demo' },
      pull_request: {
        id: 987,
        number: 12,
        title: 'Fix auth callback',
        body: null,
        head: { ref: 'feature/auth-callback', sha: 'abc123' },
        base: { ref: 'main' },
      },
      sender: { login: 'octocat' },
    }))),
  )

  it.effect('normalizes pull_request.synchronize webhook payloads', () =>
    Effect.gen(function* () {
      const event = yield* IngestGitHubWebhook({
        deliveryId: 'delivery-pr-1',
        eventName: 'pull_request',
        signature: 'sha256=test',
        payload: '{}',
      })

      expect(event).toMatchObject({
        kind: 'github.pull_request.synchronize',
        deliveryId: 'delivery-pr-1',
        installationId: 123,
        owner: 'patchplane',
        repo: 'demo',
        repositoryId: 456,
        pullRequestId: 987,
        pullRequestNumber: 12,
        headSha: 'abc123',
        headRef: 'feature/auth-callback',
        baseRef: 'main',
        sender: 'octocat',
      })
      expect(event.prompt).toContain('Fix auth callback')
    }).pipe(Effect.provide(gitHubWebhookLayer({
      action: 'synchronize',
      installation: { id: 123 },
      repository: { id: 456, owner: { login: 'patchplane' }, name: 'demo' },
      pull_request: {
        id: 987,
        number: 12,
        title: 'Fix auth callback',
        body: 'Updated the branch after review.',
        html_url: 'https://github.com/patchplane/demo/pull/12',
        head: { ref: 'feature/auth-callback', sha: 'abc123' },
        base: { ref: 'main' },
      },
      sender: { login: 'octocat' },
    }))),
  )

  it.effect('rejects malformed pull_request webhook payloads', () =>
    Effect.gen(function* () {
      const error = yield* IngestGitHubWebhook({
        deliveryId: 'delivery-pr-invalid',
        eventName: 'pull_request',
        signature: 'sha256=test',
        payload: '{}',
      }).pipe(Effect.flip)

      expect(error).toMatchObject({
        _tag: 'GitHubError',
        operation: 'normalizeGitHubWebhookEvent.pull_request',
      })
    }).pipe(Effect.provide(gitHubWebhookLayer({
      action: 'opened',
      installation: { id: 123 },
      repository: { id: 456, owner: { login: 'patchplane' }, name: 'demo' },
    }))),
  )
})
