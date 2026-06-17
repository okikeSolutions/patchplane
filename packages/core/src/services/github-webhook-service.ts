import { Context, Effect } from 'effect'
import type { GitHubError } from '@patchplane/domain/errors'
import type { GitHubWebhookVerification } from '@patchplane/domain/github'

export interface VerifyGitHubWebhookInput {
  readonly deliveryId: string
  readonly eventName: string
  readonly signature: string
  readonly payload: string
}

export class GitHubWebhookService extends Context.Service<GitHubWebhookService, {
  readonly verifyWebhook: (
    input: VerifyGitHubWebhookInput,
  ) => Effect.Effect<GitHubWebhookVerification, GitHubError>
}>()('@patchplane/core/services/GitHubWebhookService') {}
