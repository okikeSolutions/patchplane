import { Schema } from 'effect'
import {
  PullRequestExternalId,
  PullRequestNumber,
  RepositoryExternalId,
} from './candidate-subject'
import { EpochMillis, GitCommitSha, HttpUrl, PositiveInt } from './refinements'

/**
 * Provider-specific provenance stored beside a generic PatchPlane workflow.
 *
 * @remarks
 * This keeps workflow records provider-neutral while preserving enough external
 * identity for idempotency, audit trails, and publication back to the source.
 */
export const ExternalWorkflowRef = Schema.Struct({
  provider: Schema.NonEmptyString,
  deliveryId: Schema.NonEmptyString,
  eventKind: Schema.NonEmptyString,
  repositoryProvider: Schema.optional(Schema.NonEmptyString),
  repositoryInstallationId: Schema.optional(Schema.NonEmptyString),
  repositoryExternalId: Schema.optional(RepositoryExternalId),
  repositoryOwner: Schema.optional(Schema.NonEmptyString),
  repositoryName: Schema.optional(Schema.NonEmptyString),
  repositoryFullName: Schema.optional(Schema.NonEmptyString),
  issueExternalId: Schema.optional(Schema.NonEmptyString),
  issueNumber: Schema.optional(PositiveInt),
  issueTitle: Schema.optional(Schema.String),
  issueBody: Schema.optional(Schema.String),
  pullRequestExternalId: Schema.optional(PullRequestExternalId),
  pullRequestNumber: Schema.optional(PullRequestNumber),
  pullRequestUpdatedAt: Schema.optional(EpochMillis),
  pullRequestBaseSha: Schema.optional(GitCommitSha),
  pullRequestHeadSha: Schema.optional(GitCommitSha),
  pullRequestPreviousHeadSha: Schema.optional(GitCommitSha),
  pullRequestHeadRef: Schema.optional(Schema.NonEmptyString),
  pullRequestBaseRef: Schema.optional(Schema.NonEmptyString),
  commentExternalId: Schema.optional(Schema.NonEmptyString),
  url: Schema.optional(HttpUrl),
  senderProvider: Schema.optional(Schema.NonEmptyString),
  senderExternalId: Schema.optional(Schema.NonEmptyString),
  senderLogin: Schema.optional(Schema.NonEmptyString),
})
export type ExternalWorkflowRef = Schema.Schema.Type<typeof ExternalWorkflowRef>

export const decodeExternalWorkflowRef =
  Schema.decodeUnknownEffect(ExternalWorkflowRef)
