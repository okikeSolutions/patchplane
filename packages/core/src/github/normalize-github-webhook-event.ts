import { Effect, Schema } from 'effect'
import { GitHubError } from '@patchplane/domain/errors'
import {
  decodeGitHubNormalizedWorkflowEvent,
  type GitHubWebhookVerification,
} from '@patchplane/domain/github'

const GitHubIssueOpenedPayload = Schema.Struct({
  action: Schema.Literal('opened'),
  installation: Schema.Struct({ id: Schema.Number }),
  repository: Schema.Struct({
    id: Schema.Number,
    name: Schema.String,
    owner: Schema.Struct({ login: Schema.String }),
  }),
  sender: Schema.optional(Schema.Struct({ login: Schema.String })),
  issue: Schema.Struct({
    id: Schema.Number,
    number: Schema.Number,
    title: Schema.String,
    body: Schema.optional(Schema.NullOr(Schema.String)),
    html_url: Schema.optional(Schema.String),
  }),
})

const GitHubIssueCommentCreatedPayload = Schema.Struct({
  action: Schema.Literal('created'),
  installation: Schema.Struct({ id: Schema.Number }),
  repository: Schema.Struct({
    id: Schema.Number,
    name: Schema.String,
    owner: Schema.Struct({ login: Schema.String }),
  }),
  sender: Schema.optional(Schema.Struct({ login: Schema.String })),
  issue: Schema.Struct({
    id: Schema.Number,
    number: Schema.Number,
    pull_request: Schema.optional(Schema.Unknown),
  }),
  comment: Schema.Struct({
    id: Schema.Number,
    body: Schema.String,
    html_url: Schema.optional(Schema.String),
  }),
})

export const NormalizeGitHubWebhookEvent = Effect.fn(
  '@patchplane/core/github/NormalizeGitHubWebhookEvent',
)(function*(input: GitHubWebhookVerification) {
  if (input.eventName === 'issues') {
    const payload = yield* Schema.decodeUnknownEffect(GitHubIssueOpenedPayload)(
      input.payload,
    ).pipe(
      Effect.mapError(
        (cause) =>
          new GitHubError({
            operation: 'normalizeGitHubWebhookEvent.issues.opened',
            message: 'GitHub issue webhook payload is missing issue data',
            cause,
          }),
      ),
    )

    return yield* decodeGitHubNormalizedWorkflowEvent({
      kind: 'github.issue.opened',
      deliveryId: input.deliveryId,
      installationId: payload.installation.id,
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      repositoryId: payload.repository.id,
      issueId: payload.issue.id,
      issueNumber: payload.issue.number,
      title: payload.issue.title,
      prompt: [payload.issue.title, payload.issue.body ?? ''].filter(Boolean).join('\n\n'),
      ...(payload.issue.html_url === undefined ? {} : { url: payload.issue.html_url }),
      ...(payload.sender?.login === undefined ? {} : { sender: payload.sender.login }),
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

  if (input.eventName === 'issue_comment') {
    const payload = yield* Schema.decodeUnknownEffect(GitHubIssueCommentCreatedPayload)(
      input.payload,
    ).pipe(
      Effect.mapError(
        (cause) =>
          new GitHubError({
            operation: 'normalizeGitHubWebhookEvent.issue_comment.created',
            message: 'GitHub issue comment webhook payload is missing comment data',
            cause,
          }),
      ),
    )

    return yield* decodeGitHubNormalizedWorkflowEvent({
      kind: payload.issue.pull_request === undefined
        ? 'github.issue_comment.created'
        : 'github.pull_request_comment.created',
      deliveryId: input.deliveryId,
      installationId: payload.installation.id,
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      repositoryId: payload.repository.id,
      issueId: payload.issue.id,
      issueNumber: payload.issue.number,
      commentId: payload.comment.id,
      prompt: payload.comment.body,
      ...(payload.comment.html_url === undefined ? {} : { url: payload.comment.html_url }),
      ...(payload.sender?.login === undefined ? {} : { sender: payload.sender.login }),
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

  return yield* new GitHubError({
    operation: 'normalizeGitHubWebhookEvent.unsupported',
    message: `Unsupported GitHub webhook event: ${input.eventName}`,
    cause: input.payload,
  })
})
