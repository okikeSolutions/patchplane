import { Schema } from 'effect'
import {
  GitHubInstallationIdSchema,
  PromptRequestIdSchema,
  RepositoryConnectionIdSchema,
  WorkflowRunIdSchema,
} from './ids'

export const githubInstallationStatuses = [
  'pending',
  'active',
  'suspended',
  'deleted',
] as const

export const GitHubInstallationStatusSchema = Schema.Literal(
  ...githubInstallationStatuses,
)
export type GitHubInstallationStatus = Schema.Schema.Type<
  typeof GitHubInstallationStatusSchema
>

export const githubAccountTypes = ['User', 'Organization'] as const

export const GitHubAccountTypeSchema = Schema.Literal(...githubAccountTypes)
export type GitHubAccountType = Schema.Schema.Type<
  typeof GitHubAccountTypeSchema
>

export const githubRepositorySelectionModes = ['all', 'selected'] as const

export const GitHubRepositorySelectionSchema = Schema.Literal(
  ...githubRepositorySelectionModes,
)
export type GitHubRepositorySelection = Schema.Schema.Type<
  typeof GitHubRepositorySelectionSchema
>

export const githubWebhookDeliveryStatuses = [
  'received',
  'queued',
  'accepted',
  'ignored',
  'duplicate',
  'failed',
] as const

export const GitHubWebhookDeliveryStatusSchema = Schema.Literal(
  ...githubWebhookDeliveryStatuses,
)
export type GitHubWebhookDeliveryStatus = Schema.Schema.Type<
  typeof GitHubWebhookDeliveryStatusSchema
>

export const githubPublicationStatuses = [
  'pending',
  'published',
  'failed',
] as const

export const GitHubPublicationStatusSchema = Schema.Literal(
  ...githubPublicationStatuses,
)
export type GitHubPublicationStatus = Schema.Schema.Type<
  typeof GitHubPublicationStatusSchema
>

export const githubReconciliationStatuses = [
  'idle',
  'running',
  'completed',
  'failed',
] as const

export const GitHubReconciliationStatusSchema = Schema.Literal(
  ...githubReconciliationStatuses,
)
export type GitHubReconciliationStatus = Schema.Schema.Type<
  typeof GitHubReconciliationStatusSchema
>

export const githubPublicationKinds = [
  'issue_comment',
  'check_run',
  'pull_request',
] as const

export const GitHubPublicationKindSchema = Schema.Literal(
  ...githubPublicationKinds,
)
export type GitHubPublicationKind = Schema.Schema.Type<
  typeof GitHubPublicationKindSchema
>

export const githubCheckRunStatuses = [
  'queued',
  'in_progress',
  'completed',
] as const

export const GitHubCheckRunStatusSchema = Schema.Literal(
  ...githubCheckRunStatuses,
)
export type GitHubCheckRunStatus = Schema.Schema.Type<
  typeof GitHubCheckRunStatusSchema
>

export const githubCheckRunConclusions = [
  'action_required',
  'cancelled',
  'failure',
  'neutral',
  'success',
  'skipped',
  'stale',
  'timed_out',
] as const

export const GitHubCheckRunConclusionSchema = Schema.Literal(
  ...githubCheckRunConclusions,
)
export type GitHubCheckRunConclusion = Schema.Schema.Type<
  typeof GitHubCheckRunConclusionSchema
>

export const GitHubInstallationSchema = Schema.Struct({
  id: GitHubInstallationIdSchema,
  externalInstallationId: Schema.Number,
  accountLogin: Schema.String,
  accountType: GitHubAccountTypeSchema,
  targetType: GitHubAccountTypeSchema,
  repositorySelection: GitHubRepositorySelectionSchema,
  permissions: Schema.Record({
    key: Schema.String,
    value: Schema.String,
  }),
  status: GitHubInstallationStatusSchema,
  setupAction: Schema.optional(Schema.String),
  setupState: Schema.optional(Schema.String),
  installedByUserId: Schema.optional(Schema.String),
  lastSyncedAt: Schema.optional(Schema.Number),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type GitHubInstallation = Schema.Schema.Type<
  typeof GitHubInstallationSchema
>

export const GitHubRepositoryAccessSchema = Schema.Struct({
  externalRepositoryId: Schema.Number,
  externalNodeId: Schema.String,
  fullName: Schema.String,
  owner: Schema.String,
  name: Schema.String,
  defaultBranch: Schema.String,
  isPrivate: Schema.Boolean,
  isArchived: Schema.Boolean,
  isDisabled: Schema.Boolean,
})
export type GitHubRepositoryAccess = Schema.Schema.Type<
  typeof GitHubRepositoryAccessSchema
>

export const GitHubInstallationScopeSchema = Schema.Struct({
  externalInstallationId: Schema.Number,
  accountLogin: Schema.String,
  accountType: GitHubAccountTypeSchema,
  targetType: GitHubAccountTypeSchema,
  repositorySelection: GitHubRepositorySelectionSchema,
  permissions: Schema.Record({
    key: Schema.String,
    value: Schema.String,
  }),
  repositories: Schema.Array(GitHubRepositoryAccessSchema),
  syncedAt: Schema.Number,
})
export type GitHubInstallationScope = Schema.Schema.Type<
  typeof GitHubInstallationScopeSchema
>

export const RepositoryConnectionSchema = Schema.Struct({
  id: RepositoryConnectionIdSchema,
  githubInstallationId: GitHubInstallationIdSchema,
  provider: Schema.Literal('github'),
  externalRepositoryId: Schema.Number,
  externalNodeId: Schema.String,
  fullName: Schema.String,
  owner: Schema.String,
  name: Schema.String,
  defaultBranch: Schema.String,
  isPrivate: Schema.Boolean,
  isArchived: Schema.Boolean,
  isDisabled: Schema.Boolean,
  lastSyncedAt: Schema.Number,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type RepositoryConnection = Schema.Schema.Type<
  typeof RepositoryConnectionSchema
>

export const GitHubWebhookEnvelopeSchema = Schema.Struct({
  deliveryId: Schema.String,
  event: Schema.String,
  action: Schema.optional(Schema.String),
  externalInstallationId: Schema.optional(Schema.Number),
  externalRepositoryId: Schema.optional(Schema.Number),
  repositoryNodeId: Schema.optional(Schema.String),
  repositoryFullName: Schema.optional(Schema.String),
  signature: Schema.optional(Schema.String),
  signature256: Schema.optional(Schema.String),
  payload: Schema.String,
  receivedAt: Schema.Number,
})
export type GitHubWebhookEnvelope = Schema.Schema.Type<
  typeof GitHubWebhookEnvelopeSchema
>

export const WebhookDeliverySchema = Schema.Struct({
  id: Schema.String,
  deliveryId: Schema.String,
  event: Schema.String,
  action: Schema.optional(Schema.String),
  externalInstallationId: Schema.optional(Schema.Number),
  externalRepositoryId: Schema.optional(Schema.Number),
  repositoryFullName: Schema.optional(Schema.String),
  repositoryNodeId: Schema.optional(Schema.String),
  status: GitHubWebhookDeliveryStatusSchema,
  signatureVerified: Schema.Boolean,
  commandEmitted: Schema.Boolean,
  payload: Schema.String,
  promptRequestId: Schema.optional(Schema.String),
  workflowRunId: Schema.optional(Schema.String),
  receivedAt: Schema.Number,
  processedAt: Schema.optional(Schema.Number),
  errorMessage: Schema.optional(Schema.String),
})
export type WebhookDelivery = Schema.Schema.Type<typeof WebhookDeliverySchema>

export const IssueBindingSchema = Schema.Struct({
  id: Schema.String,
  repositoryConnectionId: RepositoryConnectionIdSchema,
  issueNumber: Schema.Number,
  promptRequestId: PromptRequestIdSchema,
  workflowRunId: Schema.optional(WorkflowRunIdSchema),
  latestCommentId: Schema.optional(Schema.Number),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type IssueBinding = Schema.Schema.Type<typeof IssueBindingSchema>

export const PullRequestBindingSchema = Schema.Struct({
  id: Schema.String,
  repositoryConnectionId: RepositoryConnectionIdSchema,
  pullRequestNumber: Schema.Number,
  promptRequestId: PromptRequestIdSchema,
  workflowRunId: Schema.optional(WorkflowRunIdSchema),
  headBranch: Schema.String,
  baseBranch: Schema.String,
  draft: Schema.Boolean,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type PullRequestBinding = Schema.Schema.Type<
  typeof PullRequestBindingSchema
>

export const GitHubPublicationRecordSchema = Schema.Struct({
  id: Schema.String,
  workflowRunId: WorkflowRunIdSchema,
  repositoryConnectionId: RepositoryConnectionIdSchema,
  publicationKey: Schema.String,
  kind: GitHubPublicationKindSchema,
  status: GitHubPublicationStatusSchema,
  externalPublicationId: Schema.optional(Schema.String),
  requestBody: Schema.String,
  responseBody: Schema.optional(Schema.String),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  publishedAt: Schema.optional(Schema.Number),
})
export type GitHubPublicationRecord = Schema.Schema.Type<
  typeof GitHubPublicationRecordSchema
>

export const GitHubWebhookReconciliationStateSchema = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
  lastSuccessfulRedeliveryStartedAt: Schema.optional(Schema.Number),
  lastRunStartedAt: Schema.optional(Schema.Number),
  lastRunCompletedAt: Schema.optional(Schema.Number),
  lastRunStatus: GitHubReconciliationStatusSchema,
  lastErrorMessage: Schema.optional(Schema.String),
  updatedAt: Schema.Number,
})
export type GitHubWebhookReconciliationState = Schema.Schema.Type<
  typeof GitHubWebhookReconciliationStateSchema
>

export const GitHubWebhookDeliveryAttemptSchema = Schema.Struct({
  attemptId: Schema.Number,
  guid: Schema.String,
  status: Schema.String,
  deliveredAt: Schema.String,
  redelivery: Schema.Boolean,
})
export type GitHubWebhookDeliveryAttempt = Schema.Schema.Type<
  typeof GitHubWebhookDeliveryAttemptSchema
>

export const GitHubInstallationTokenSchema = Schema.Struct({
  token: Schema.String,
  expiresAt: Schema.String,
})
export type GitHubInstallationToken = Schema.Schema.Type<
  typeof GitHubInstallationTokenSchema
>

export const GitHubIssueCommentPublicationSchema = Schema.Struct({
  kind: Schema.Literal('issue_comment'),
  externalInstallationId: Schema.Number,
  owner: Schema.String,
  repo: Schema.String,
  issueNumber: Schema.Number,
  body: Schema.String,
  existingCommentId: Schema.optional(Schema.Number),
})

export const GitHubCheckRunPublicationSchema = Schema.Struct({
  kind: Schema.Literal('check_run'),
  externalInstallationId: Schema.Number,
  owner: Schema.String,
  repo: Schema.String,
  name: Schema.String,
  headSha: Schema.String,
  status: GitHubCheckRunStatusSchema,
  conclusion: Schema.optional(GitHubCheckRunConclusionSchema),
  summary: Schema.String,
  text: Schema.optional(Schema.String),
  existingCheckRunId: Schema.optional(Schema.Number),
})

export const GitHubPullRequestPublicationSchema = Schema.Struct({
  kind: Schema.Literal('pull_request'),
  externalInstallationId: Schema.Number,
  owner: Schema.String,
  repo: Schema.String,
  title: Schema.String,
  body: Schema.String,
  head: Schema.String,
  base: Schema.String,
  draft: Schema.Boolean,
  existingPullRequestNumber: Schema.optional(Schema.Number),
})

export const GitHubPublicationCommandSchema = Schema.Union(
  GitHubIssueCommentPublicationSchema,
  GitHubCheckRunPublicationSchema,
  GitHubPullRequestPublicationSchema,
)
export type GitHubPublicationCommand = Schema.Schema.Type<
  typeof GitHubPublicationCommandSchema
>

export const GitHubPublicationReceiptSchema = Schema.Struct({
  kind: GitHubPublicationKindSchema,
  externalPublicationId: Schema.String,
})
export type GitHubPublicationReceipt = Schema.Schema.Type<
  typeof GitHubPublicationReceiptSchema
>
