import { Schema } from 'effect'
import { EpochMillis, GitCommitSha, HttpUrl } from './refinements'

const PositiveSafeInteger = Schema.Int.check(Schema.isGreaterThan(0))

export const GitHubInstallationId = PositiveSafeInteger.pipe(
  Schema.brand('GitHubInstallationId'),
)
export type GitHubInstallationId = Schema.Schema.Type<
  typeof GitHubInstallationId
>

export const GitHubRepositoryId = PositiveSafeInteger.pipe(
  Schema.brand('GitHubRepositoryId'),
)
export const GitHubIssueId = PositiveSafeInteger.pipe(
  Schema.brand('GitHubIssueId'),
)
export const GitHubIssueNumber = PositiveSafeInteger.pipe(
  Schema.brand('GitHubIssueNumber'),
)
export const GitHubCommentId = PositiveSafeInteger.pipe(
  Schema.brand('GitHubCommentId'),
)
export const GitHubPullRequestId = PositiveSafeInteger.pipe(
  Schema.brand('GitHubPullRequestId'),
)
export const GitHubPullRequestNumber = PositiveSafeInteger.pipe(
  Schema.brand('GitHubPullRequestNumber'),
)
export const GitHubRepositoryRef = Schema.Struct({
  provider: Schema.Literal('github'),
  installationId: GitHubInstallationId,
  owner: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  fullName: Schema.NonEmptyString,
  repositoryExternalId: Schema.optional(Schema.NonEmptyString),
  private: Schema.optional(Schema.Boolean),
})
export type GitHubRepositoryRef = Schema.Schema.Type<typeof GitHubRepositoryRef>
export const decodeGitHubRepositoryRef =
  Schema.decodeUnknownEffect(GitHubRepositoryRef)

export const GitHubWebhookVerification = Schema.Struct({
  deliveryId: Schema.NonEmptyString,
  eventName: Schema.NonEmptyString,
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
    deliveryId: Schema.NonEmptyString,
    installationId: GitHubInstallationId,
    owner: Schema.NonEmptyString,
    repo: Schema.NonEmptyString,
    repositoryId: GitHubRepositoryId,
    issueId: GitHubIssueId,
    issueNumber: GitHubIssueNumber,
    title: Schema.String,
    body: Schema.String,
    prompt: Schema.String,
    url: Schema.optional(HttpUrl),
    sender: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literals([
      'github.issue_comment.created',
      'github.pull_request_comment.created',
    ]),
    deliveryId: Schema.NonEmptyString,
    installationId: GitHubInstallationId,
    owner: Schema.NonEmptyString,
    repo: Schema.NonEmptyString,
    repositoryId: GitHubRepositoryId,
    issueId: GitHubIssueId,
    issueNumber: GitHubIssueNumber,
    commentId: GitHubCommentId,
    prompt: Schema.String,
    url: Schema.optional(HttpUrl),
    sender: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literals([
      'github.pull_request.opened',
      'github.pull_request.synchronize',
    ]),
    deliveryId: Schema.NonEmptyString,
    installationId: GitHubInstallationId,
    owner: Schema.NonEmptyString,
    repo: Schema.NonEmptyString,
    repositoryId: GitHubRepositoryId,
    pullRequestId: GitHubPullRequestId,
    pullRequestNumber: GitHubPullRequestNumber,
    pullRequestUpdatedAt: EpochMillis,
    title: Schema.String,
    body: Schema.String,
    prompt: Schema.String,
    baseSha: GitCommitSha,
    headSha: GitCommitSha,
    previousHeadSha: Schema.optional(GitCommitSha),
    headRef: Schema.NonEmptyString,
    baseRef: Schema.NonEmptyString,
    url: Schema.optional(HttpUrl),
    sender: Schema.optional(Schema.String),
  }),
]).check(
  Schema.makeFilter(
    (event) =>
      event.kind === 'github.pull_request.synchronize'
        ? 'previousHeadSha' in event && event.previousHeadSha !== undefined
        : !('previousHeadSha' in event) || event.previousHeadSha === undefined,
    { expected: 'synchronize event with a previous head SHA' },
  ),
)
export type GitHubNormalizedWorkflowEvent = Schema.Schema.Type<
  typeof GitHubNormalizedWorkflowEvent
>
export const decodeGitHubNormalizedWorkflowEvent = Schema.decodeUnknownEffect(
  GitHubNormalizedWorkflowEvent,
)
