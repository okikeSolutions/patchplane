import { Schema } from 'effect'

export const GitHubInstallationId = Schema.Number
export type GitHubInstallationId = Schema.Schema.Type<
  typeof GitHubInstallationId
>

export const GitHubRepositoryRef = Schema.Struct({
  provider: Schema.Literal('github'),
  installationId: GitHubInstallationId,
  owner: Schema.String,
  name: Schema.String,
  fullName: Schema.String,
})
export type GitHubRepositoryRef = Schema.Schema.Type<
  typeof GitHubRepositoryRef
>
export const decodeGitHubRepositoryRef =
  Schema.decodeUnknownEffect(GitHubRepositoryRef)

export const GitHubWebhookVerification = Schema.Struct({
  deliveryId: Schema.String,
  eventName: Schema.String,
  payload: Schema.Unknown,
})
export type GitHubWebhookVerification = Schema.Schema.Type<
  typeof GitHubWebhookVerification
>
export const decodeGitHubWebhookVerification = Schema.decodeUnknownEffect(
  GitHubWebhookVerification,
)

export const GitHubNormalizedWorkflowEvent = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('github.issue.opened'),
    deliveryId: Schema.String,
    installationId: GitHubInstallationId,
    owner: Schema.String,
    repo: Schema.String,
    repositoryId: Schema.Number,
    issueId: Schema.Number,
    issueNumber: Schema.Number,
    title: Schema.String,
    prompt: Schema.String,
    url: Schema.optional(Schema.String),
    sender: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literals([
      'github.issue_comment.created',
      'github.pull_request_comment.created',
    ]),
    deliveryId: Schema.String,
    installationId: GitHubInstallationId,
    owner: Schema.String,
    repo: Schema.String,
    repositoryId: Schema.Number,
    issueId: Schema.Number,
    issueNumber: Schema.Number,
    commentId: Schema.Number,
    prompt: Schema.String,
    url: Schema.optional(Schema.String),
    sender: Schema.optional(Schema.String),
  }),
])
export type GitHubNormalizedWorkflowEvent = Schema.Schema.Type<
  typeof GitHubNormalizedWorkflowEvent
>
export const decodeGitHubNormalizedWorkflowEvent = Schema.decodeUnknownEffect(
  GitHubNormalizedWorkflowEvent,
)
