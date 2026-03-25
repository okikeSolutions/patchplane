import { Schema } from 'effect'
import { v } from 'convex/values'
import {
  GitHubInstallationSchema,
  GitHubPublicationRecordSchema,
  GitHubWebhookReconciliationStateSchema,
  IssueBindingSchema,
  PromptRequestCommandSchema,
  PromptRequestSchema,
  PullRequestBindingSchema,
  RepositoryConnectionSchema,
  ReviewRunSchema,
  RuntimeEventSchema,
  RuntimeSessionSchema,
  WebhookDeliverySchema,
  WorkflowRunSchema,
  githubAccountTypes,
  githubInstallationStatuses,
  githubPublicationKinds,
  githubPublicationStatuses,
  githubReconciliationStatuses,
  githubRepositorySelectionModes,
  githubWebhookDeliveryStatuses,
  mergeDecisionStatuses,
  runtimeEventTypes,
  runtimeSessionStatuses,
  workflowRunStatuses,
  workflowStatuses,
} from '@patchplane/domain'

export const workflowStatusValidator = v.union(
  v.literal(workflowStatuses[0]),
  v.literal(workflowStatuses[1]),
  v.literal(workflowStatuses[2]),
  v.literal(workflowStatuses[3]),
  v.literal(workflowStatuses[4]),
)

export const workflowRunStatusValidator = v.union(
  v.literal(workflowRunStatuses[0]),
  v.literal(workflowRunStatuses[1]),
  v.literal(workflowRunStatuses[2]),
  v.literal(workflowRunStatuses[3]),
  v.literal(workflowRunStatuses[4]),
  v.literal(workflowRunStatuses[5]),
  v.literal(workflowRunStatuses[6]),
)

export const runtimeSessionStatusValidator = v.union(
  v.literal(runtimeSessionStatuses[0]),
  v.literal(runtimeSessionStatuses[1]),
  v.literal(runtimeSessionStatuses[2]),
  v.literal(runtimeSessionStatuses[3]),
  v.literal(runtimeSessionStatuses[4]),
  v.literal(runtimeSessionStatuses[5]),
)

export const runtimeEventTypeValidator = v.union(
  v.literal(runtimeEventTypes[0]),
  v.literal(runtimeEventTypes[1]),
  v.literal(runtimeEventTypes[2]),
  v.literal(runtimeEventTypes[3]),
  v.literal(runtimeEventTypes[4]),
  v.literal(runtimeEventTypes[5]),
  v.literal(runtimeEventTypes[6]),
  v.literal(runtimeEventTypes[7]),
  v.literal(runtimeEventTypes[8]),
)

export const githubAccountTypeValidator = v.union(
  v.literal(githubAccountTypes[0]),
  v.literal(githubAccountTypes[1]),
)

export const githubInstallationStatusValidator = v.union(
  v.literal(githubInstallationStatuses[0]),
  v.literal(githubInstallationStatuses[1]),
  v.literal(githubInstallationStatuses[2]),
  v.literal(githubInstallationStatuses[3]),
)

export const githubRepositorySelectionValidator = v.union(
  v.literal(githubRepositorySelectionModes[0]),
  v.literal(githubRepositorySelectionModes[1]),
)

export const githubWebhookDeliveryStatusValidator = v.union(
  v.literal(githubWebhookDeliveryStatuses[0]),
  v.literal(githubWebhookDeliveryStatuses[1]),
  v.literal(githubWebhookDeliveryStatuses[2]),
  v.literal(githubWebhookDeliveryStatuses[3]),
  v.literal(githubWebhookDeliveryStatuses[4]),
  v.literal(githubWebhookDeliveryStatuses[5]),
)

export const githubPublicationStatusValidator = v.union(
  v.literal(githubPublicationStatuses[0]),
  v.literal(githubPublicationStatuses[1]),
  v.literal(githubPublicationStatuses[2]),
)

export const githubPublicationKindValidator = v.union(
  v.literal(githubPublicationKinds[0]),
  v.literal(githubPublicationKinds[1]),
  v.literal(githubPublicationKinds[2]),
)

export const githubReconciliationStatusValidator = v.union(
  v.literal(githubReconciliationStatuses[0]),
  v.literal(githubReconciliationStatuses[1]),
  v.literal(githubReconciliationStatuses[2]),
  v.literal(githubReconciliationStatuses[3]),
)

export const mergeDecisionStatusValidator = v.union(
  v.literal(mergeDecisionStatuses[0]),
  v.literal(mergeDecisionStatuses[1]),
  v.literal(mergeDecisionStatuses[2]),
)

export const promptScopeValidator = v.object({
  repoUrl: v.string(),
  baseBranch: v.string(),
  targetBranch: v.string(),
  includePaths: v.array(v.string()),
  excludePaths: v.array(v.string()),
  intent: v.string(),
})

export const promptRequestSourceValidator = v.union(
  v.object({
    kind: v.literal('manual'),
  }),
  v.object({
    kind: v.literal('github.issue_comment'),
    deliveryId: v.string(),
    externalInstallationId: v.number(),
    externalRepositoryId: v.number(),
    externalRepositoryNodeId: v.string(),
    repositoryFullName: v.string(),
    issueNumber: v.number(),
    commentId: v.number(),
    actorLogin: v.string(),
    command: v.string(),
  }),
)

export const promptRequestCommandValidator = v.object({
  kind: v.literal('prompt_request.create'),
  projectId: v.string(),
  executionTargetId: v.string(),
  policyBundleId: v.string(),
  createdByUserId: v.string(),
  prompt: v.string(),
  scope: promptScopeValidator,
  source: promptRequestSourceValidator,
})

export const githubInstallationValidator = v.object({
  externalInstallationId: v.number(),
  accountLogin: v.string(),
  accountType: githubAccountTypeValidator,
  targetType: githubAccountTypeValidator,
  repositorySelection: githubRepositorySelectionValidator,
  permissions: v.record(v.string(), v.string()),
  status: githubInstallationStatusValidator,
  setupAction: v.optional(v.string()),
  setupState: v.optional(v.string()),
  installedByUserId: v.optional(v.string()),
  lastSyncedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})

export const repositoryConnectionValidator = v.object({
  githubInstallationId: v.id('githubInstallations'),
  provider: v.literal('github'),
  externalRepositoryId: v.number(),
  externalNodeId: v.string(),
  fullName: v.string(),
  owner: v.string(),
  name: v.string(),
  defaultBranch: v.string(),
  isPrivate: v.boolean(),
  isArchived: v.boolean(),
  isDisabled: v.boolean(),
  lastSyncedAt: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
})

export const webhookDeliveryValidator = v.object({
  deliveryId: v.string(),
  event: v.string(),
  action: v.optional(v.string()),
  externalInstallationId: v.optional(v.number()),
  externalRepositoryId: v.optional(v.number()),
  repositoryFullName: v.optional(v.string()),
  repositoryNodeId: v.optional(v.string()),
  status: githubWebhookDeliveryStatusValidator,
  signatureVerified: v.boolean(),
  commandEmitted: v.boolean(),
  payload: v.string(),
  promptRequestId: v.optional(v.id('promptRequests')),
  workflowRunId: v.optional(v.id('workflowRuns')),
  receivedAt: v.number(),
  processedAt: v.optional(v.number()),
  errorMessage: v.optional(v.string()),
})

export const workflowRunValidator = v.object({
  promptRequestId: v.id('promptRequests'),
  githubInstallationId: v.optional(v.id('githubInstallations')),
  repositoryConnectionId: v.optional(v.id('repositories')),
  sandboxProvider: v.string(),
  runtimeProvider: v.string(),
  status: workflowRunStatusValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
})

export const runtimeSessionValidator = v.object({
  workflowRunId: v.id('workflowRuns'),
  externalSessionId: v.optional(v.string()),
  sandboxProvider: v.string(),
  runtimeProvider: v.string(),
  status: runtimeSessionStatusValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
  startedAt: v.optional(v.number()),
  endedAt: v.optional(v.number()),
})

export const runtimeEventValidator = v.object({
  requestId: v.id('promptRequests'),
  workflowRunId: v.optional(v.id('workflowRuns')),
  runtimeSessionId: v.optional(v.id('runtimeSessions')),
  type: runtimeEventTypeValidator,
  message: v.string(),
  createdAt: v.number(),
})

export const reviewRunValidator = v.object({
  requestId: v.id('promptRequests'),
  reviewer: v.string(),
  score: v.number(),
  passed: v.boolean(),
  summary: v.string(),
})

export const issueBindingValidator = v.object({
  repositoryConnectionId: v.id('repositories'),
  issueNumber: v.number(),
  promptRequestId: v.id('promptRequests'),
  workflowRunId: v.optional(v.id('workflowRuns')),
  latestCommentId: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})

export const pullRequestBindingValidator = v.object({
  repositoryConnectionId: v.id('repositories'),
  pullRequestNumber: v.number(),
  promptRequestId: v.id('promptRequests'),
  workflowRunId: v.optional(v.id('workflowRuns')),
  headBranch: v.string(),
  baseBranch: v.string(),
  draft: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
})

export const githubPublicationRecordValidator = v.object({
  workflowRunId: v.id('workflowRuns'),
  repositoryConnectionId: v.id('repositories'),
  publicationKey: v.string(),
  kind: githubPublicationKindValidator,
  status: githubPublicationStatusValidator,
  externalPublicationId: v.optional(v.string()),
  requestBody: v.string(),
  responseBody: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  publishedAt: v.optional(v.number()),
})

export const githubWebhookReconciliationStateValidator = v.object({
  key: v.string(),
  lastSuccessfulRedeliveryStartedAt: v.optional(v.number()),
  lastRunStartedAt: v.optional(v.number()),
  lastRunCompletedAt: v.optional(v.number()),
  lastRunStatus: githubReconciliationStatusValidator,
  lastErrorMessage: v.optional(v.string()),
  updatedAt: v.number(),
})

export const decodePromptRequest = Schema.decodeUnknownSync(PromptRequestSchema)
export const decodePromptRequestCommand = Schema.decodeUnknownSync(
  PromptRequestCommandSchema,
)
export const decodeWorkflowRun = Schema.decodeUnknownSync(WorkflowRunSchema)
export const decodeRuntimeSession =
  Schema.decodeUnknownSync(RuntimeSessionSchema)
export const decodeRuntimeEvent = Schema.decodeUnknownSync(RuntimeEventSchema)
export const decodeReviewRun = Schema.decodeUnknownSync(ReviewRunSchema)
export const decodeGitHubInstallation = Schema.decodeUnknownSync(
  GitHubInstallationSchema,
)
export const decodeRepositoryConnection = Schema.decodeUnknownSync(
  RepositoryConnectionSchema,
)
export const decodeWebhookDelivery = Schema.decodeUnknownSync(
  WebhookDeliverySchema,
)
export const decodeIssueBinding = Schema.decodeUnknownSync(IssueBindingSchema)
export const decodePullRequestBinding = Schema.decodeUnknownSync(
  PullRequestBindingSchema,
)
export const decodeGitHubPublicationRecord = Schema.decodeUnknownSync(
  GitHubPublicationRecordSchema,
)
export const decodeGitHubWebhookReconciliationState = Schema.decodeUnknownSync(
  GitHubWebhookReconciliationStateSchema,
)
