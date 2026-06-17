import { Effect } from 'effect'
import { GitHubError } from '@patchplane/domain/errors'
import {
  decodeGitHubNormalizedWorkflowEvent,
  type GitHubNormalizedWorkflowEvent,
} from '@patchplane/domain/github'
import { makeGitHubAppActorId, type WorkspaceId } from '@patchplane/domain/ids'
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

function property(value: unknown, key: string) {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }

  return Reflect.get(value, key)
}

function stringProperty(value: unknown, key: string) {
  const item = property(value, key)
  return typeof item === 'string' ? item : undefined
}

function numberProperty(value: unknown, key: string) {
  const item = property(value, key)
  return typeof item === 'number' ? item : undefined
}

function installationId(payload: unknown) {
  return numberProperty(property(payload, 'installation'), 'id')
}

function repository(payload: unknown) {
  const repositoryValue = property(payload, 'repository')
  const ownerValue = property(repositoryValue, 'owner')
  return {
    id: numberProperty(repositoryValue, 'id'),
    owner: stringProperty(ownerValue, 'login'),
    repo: stringProperty(repositoryValue, 'name'),
  }
}

function sender(payload: unknown) {
  return stringProperty(property(payload, 'sender'), 'login')
}

function isObject(value: unknown) {
  return typeof value === 'object' && value !== null
}

function normalizeGitHubWebhookEvent(input: {
  readonly deliveryId: string
  readonly eventName: string
  readonly payload: unknown
}) {
  const action = stringProperty(input.payload, 'action')
  const id = installationId(input.payload)
  const repo = repository(input.payload)

  if (
    id === undefined ||
    repo.id === undefined ||
    repo.owner === undefined ||
    repo.repo === undefined
  ) {
    return Effect.fail(
      new GitHubError({
        operation: 'normalizeGitHubWebhookEvent',
        message: 'GitHub webhook payload is missing installation or repository data',
        cause: input.payload,
      }),
    )
  }

  if (input.eventName === 'issues' && action === 'opened') {
    const issue = property(input.payload, 'issue')
    const issueId = numberProperty(issue, 'id')
    const issueNumber = numberProperty(issue, 'number')
    const title = stringProperty(issue, 'title')
    const body = stringProperty(issue, 'body') ?? ''

    if (issueId === undefined || issueNumber === undefined || title === undefined) {
      return Effect.fail(
        new GitHubError({
          operation: 'normalizeGitHubWebhookEvent.issues.opened',
          message: 'GitHub issue webhook payload is missing issue data',
          cause: input.payload,
        }),
      )
    }

    return decodeGitHubNormalizedWorkflowEvent({
      kind: 'github.issue.opened',
      deliveryId: input.deliveryId,
      installationId: id,
      owner: repo.owner,
      repo: repo.repo,
      repositoryId: repo.id,
      issueId,
      issueNumber,
      title,
      prompt: [title, body].filter(Boolean).join('\n\n'),
      url: stringProperty(issue, 'html_url'),
      sender: sender(input.payload),
    }).pipe(
      Effect.mapError(
        (cause) =>
          new GitHubError({
            operation: 'normalizeGitHubWebhookEvent.decode',
            message: 'Normalized GitHub issue event is invalid',
            cause,
          }),
      ),
    )
  }

  if (input.eventName === 'issue_comment' && action === 'created') {
    const issue = property(input.payload, 'issue')
    const comment = property(input.payload, 'comment')
    const issueId = numberProperty(issue, 'id')
    const issueNumber = numberProperty(issue, 'number')
    const commentId = numberProperty(comment, 'id')
    const body = stringProperty(comment, 'body')

    if (
      issueId === undefined ||
      issueNumber === undefined ||
      commentId === undefined ||
      body === undefined
    ) {
      return Effect.fail(
        new GitHubError({
          operation: 'normalizeGitHubWebhookEvent.issue_comment.created',
          message: 'GitHub issue comment webhook payload is missing comment data',
          cause: input.payload,
        }),
      )
    }

    return decodeGitHubNormalizedWorkflowEvent({
      kind: isObject(property(issue, 'pull_request'))
        ? 'github.pull_request_comment.created'
        : 'github.issue_comment.created',
      deliveryId: input.deliveryId,
      installationId: id,
      owner: repo.owner,
      repo: repo.repo,
      repositoryId: repo.id,
      issueId,
      issueNumber,
      commentId,
      prompt: body,
      url: stringProperty(comment, 'html_url'),
      sender: sender(input.payload),
    }).pipe(
      Effect.mapError(
        (cause) =>
          new GitHubError({
            operation: 'normalizeGitHubWebhookEvent.decode',
            message: 'Normalized GitHub issue comment event is invalid',
            cause,
          }),
      ),
    )
  }

  return Effect.fail(
    new GitHubError({
      operation: 'normalizeGitHubWebhookEvent.unsupported',
      message: `Unsupported GitHub webhook event: ${input.eventName}.${action ?? 'unknown'}`,
      cause: input.payload,
    }),
  )
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
  const event = yield* normalizeGitHubWebhookEvent(verified)

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
