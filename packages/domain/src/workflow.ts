import { Schema } from 'effect'
import {
  ExecutionTargetIdSchema,
  GitHubInstallationIdSchema,
  PolicyBundleIdSchema,
  PromptRequestIdSchema,
  RepositoryConnectionIdSchema,
  WorkflowRunIdSchema,
} from './ids'

export const workflowStatuses = [
  'queued',
  'running',
  'reviewed',
  'completed',
  'failed',
] as const

export const WorkflowStatusSchema = Schema.Literal(...workflowStatuses)
export type WorkflowStatus = Schema.Schema.Type<typeof WorkflowStatusSchema>

export const workflowRunStatuses = [
  'queued',
  'launching',
  'running',
  'reviewed',
  'completed',
  'failed',
  'cancelled',
] as const

export const WorkflowRunStatusSchema = Schema.Literal(...workflowRunStatuses)
export type WorkflowRunStatus = Schema.Schema.Type<
  typeof WorkflowRunStatusSchema
>

export const mergeDecisionStatuses = [
  'pending',
  'approved',
  'rejected',
] as const

export const MergeDecisionStatusSchema = Schema.Literal(
  ...mergeDecisionStatuses,
)
export type MergeDecisionStatus = Schema.Schema.Type<
  typeof MergeDecisionStatusSchema
>

export const statusLabels: Record<WorkflowStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  reviewed: 'Reviewed',
  completed: 'Completed',
  failed: 'Failed',
}

export const PromptScopeSchema = Schema.Struct({
  repoUrl: Schema.String,
  baseBranch: Schema.String,
  targetBranch: Schema.String,
  includePaths: Schema.Array(Schema.String),
  excludePaths: Schema.Array(Schema.String),
  intent: Schema.String,
})
export type PromptScope = Schema.Schema.Type<typeof PromptScopeSchema>

export const ManualPromptSourceSchema = Schema.Struct({
  kind: Schema.Literal('manual'),
})

export const GitHubIssueCommentPromptSourceSchema = Schema.Struct({
  kind: Schema.Literal('github.issue_comment'),
  deliveryId: Schema.String,
  externalInstallationId: Schema.Number,
  externalRepositoryId: Schema.Number,
  externalRepositoryNodeId: Schema.String,
  repositoryFullName: Schema.String,
  issueNumber: Schema.Number,
  commentId: Schema.Number,
  actorLogin: Schema.String,
  command: Schema.String,
})

export const PromptRequestSourceSchema = Schema.Union(
  ManualPromptSourceSchema,
  GitHubIssueCommentPromptSourceSchema,
)
export type PromptRequestSource = Schema.Schema.Type<
  typeof PromptRequestSourceSchema
>

export const PromptRequestSchema = Schema.Struct({
  id: PromptRequestIdSchema,
  projectId: Schema.String,
  executionTargetId: ExecutionTargetIdSchema,
  policyBundleId: PolicyBundleIdSchema,
  createdByUserId: Schema.String,
  prompt: Schema.String,
  scope: PromptScopeSchema,
  source: PromptRequestSourceSchema,
  status: WorkflowStatusSchema,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type PromptRequest = Schema.Schema.Type<typeof PromptRequestSchema>

export const WorkflowRunSchema = Schema.Struct({
  id: WorkflowRunIdSchema,
  promptRequestId: PromptRequestIdSchema,
  githubInstallationId: Schema.optional(GitHubInstallationIdSchema),
  repositoryConnectionId: Schema.optional(RepositoryConnectionIdSchema),
  sandboxProvider: Schema.String,
  runtimeProvider: Schema.String,
  status: WorkflowRunStatusSchema,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  startedAt: Schema.optional(Schema.Number),
  completedAt: Schema.optional(Schema.Number),
})
export type WorkflowRun = Schema.Schema.Type<typeof WorkflowRunSchema>

export const ReviewRunSchema = Schema.Struct({
  id: Schema.String,
  requestId: PromptRequestIdSchema,
  workflowRunId: WorkflowRunIdSchema,
  reviewer: Schema.String,
  score: Schema.Number,
  passed: Schema.Boolean,
  summary: Schema.String,
})
export type ReviewRun = Schema.Schema.Type<typeof ReviewRunSchema>

export const coreCapabilities = [
  {
    name: 'Request coordination',
    summary:
      'Track prompts, scopes, policies, and the current lifecycle state.',
  },
  {
    name: 'Runtime normalization',
    summary:
      'Project runtime-specific events into one shared operational timeline.',
  },
  {
    name: 'Review orchestration',
    summary:
      'Capture typed review outputs before merge and rollback logic exists.',
  },
  {
    name: 'Lineage visibility',
    summary:
      'Explain how a request became a run, review, and eventual decision.',
  },
] as const
