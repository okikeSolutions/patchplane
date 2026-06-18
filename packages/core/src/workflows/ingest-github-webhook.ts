import { Effect } from 'effect'
import { GitHubError } from '@patchplane/domain/errors'
import type { GitHubNormalizedWorkflowEvent } from '@patchplane/domain/github'
import { makeGitHubAppActorId, type WorkspaceId } from '@patchplane/domain/ids'
import { NormalizeGitHubWebhookEvent } from '../github/normalize-github-webhook-event'
import { GitHubWebhookService } from '../services/github-webhook-service'
import { GitHubEventToWorkflowIntake } from './github-event-to-intake'

export interface IngestGitHubWebhookInput {
  readonly deliveryId: string
  readonly eventName: string
  readonly signature: string
  readonly payload: string
}

export interface IngestGitHubWebhookToWorkflowIntakeInput
  extends IngestGitHubWebhookInput {
  readonly workspaceId: WorkspaceId
  readonly traceId: string
}

export const IngestGitHubWebhook = Effect.fn(
  '@patchplane/core/workflows/IngestGitHubWebhook',
)(function*(input: IngestGitHubWebhookInput): Effect.fn.Return<
  GitHubNormalizedWorkflowEvent,
  GitHubError,
  GitHubWebhookService
> {
  yield* Effect.annotateCurrentSpan({
    deliveryId: input.deliveryId,
    eventName: input.eventName,
  })

  const githubWebhooks = yield* GitHubWebhookService
  const verified = yield* githubWebhooks.verifyWebhook(input)
  const event = yield* NormalizeGitHubWebhookEvent(verified)

  yield* Effect.logInfo('Ingested GitHub webhook event', {
    deliveryId: event.deliveryId,
    kind: event.kind,
    owner: event.owner,
    repo: event.repo,
  })

  return event
})

export const IngestGitHubWebhookToWorkflowIntake = Effect.fn(
  '@patchplane/core/workflows/IngestGitHubWebhookToWorkflowIntake',
)(function*(input: IngestGitHubWebhookToWorkflowIntakeInput) {
  const event = yield* IngestGitHubWebhook(input)

  return yield* GitHubEventToWorkflowIntake(event, {
    actor: {
      id: makeGitHubAppActorId(String(event.installationId)),
      displayName: `GitHub App installation ${event.installationId}`,
    },
    workspaceId: input.workspaceId,
    traceId: input.traceId,
  })
})
