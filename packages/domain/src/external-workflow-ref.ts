import { Schema } from 'effect'

/**
 * Provider-specific provenance stored beside a generic PatchPlane workflow.
 *
 * @remarks
 * This keeps workflow records provider-neutral while preserving enough external
 * identity for idempotency, audit trails, and publication back to the source.
 */
export const ExternalWorkflowRef = Schema.Struct({
  provider: Schema.String,
  deliveryId: Schema.String,
  eventKind: Schema.String,
  repositoryProvider: Schema.optional(Schema.String),
  repositoryInstallationId: Schema.optional(Schema.String),
  repositoryExternalId: Schema.optional(Schema.String),
  repositoryOwner: Schema.optional(Schema.String),
  repositoryName: Schema.optional(Schema.String),
  repositoryFullName: Schema.optional(Schema.String),
  issueExternalId: Schema.optional(Schema.String),
  issueNumber: Schema.optional(Schema.Number),
  issueTitle: Schema.optional(Schema.String),
  pullRequestExternalId: Schema.optional(Schema.String),
  pullRequestNumber: Schema.optional(Schema.Number),
  pullRequestHeadSha: Schema.optional(Schema.String),
  pullRequestHeadRef: Schema.optional(Schema.String),
  pullRequestBaseRef: Schema.optional(Schema.String),
  commentExternalId: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  senderProvider: Schema.optional(Schema.String),
  senderExternalId: Schema.optional(Schema.String),
  senderLogin: Schema.optional(Schema.String),
})
export type ExternalWorkflowRef = Schema.Schema.Type<typeof ExternalWorkflowRef>

export const decodeExternalWorkflowRef = Schema.decodeUnknownEffect(
  ExternalWorkflowRef,
)
