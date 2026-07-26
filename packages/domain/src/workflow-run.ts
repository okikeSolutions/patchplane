import { Schema } from 'effect'
import { PromptRequestId, WorkflowRunId, WorkspaceId } from './ids'

export const WorkflowStatus = Schema.Literals(['queued', 'running', 'reviewed', 'failed'])
export type WorkflowStatus = Schema.Schema.Type<typeof WorkflowStatus>

/**
 * Versioned workflow-attempt semantics.
 *
 * Legacy rows may omit these fields. Every V1 workflow run is one immutable
 * patch attempt; an intentional rerun creates a child workflow run.
 */
export const WorkflowRunModelVersion = Schema.Literals(['v1'])
export type WorkflowRunModelVersion = Schema.Schema.Type<typeof WorkflowRunModelVersion>

export const WorkflowRunTrigger = Schema.Literals(['intake', 'rerun'])
export type WorkflowRunTrigger = Schema.Schema.Type<typeof WorkflowRunTrigger>

export const WorkflowRun = Schema.Struct({
  id: WorkflowRunId,
  promptRequestId: PromptRequestId,
  workspaceId: WorkspaceId,
  traceId: Schema.String,
  status: WorkflowStatus,
  modelVersion: Schema.optional(WorkflowRunModelVersion),
  parentWorkflowRunId: Schema.optional(WorkflowRunId),
  rootWorkflowRunId: Schema.optional(WorkflowRunId),
  attemptNumber: Schema.optional(Schema.Number),
  trigger: Schema.optional(WorkflowRunTrigger),
  sourceCommitSha: Schema.optional(Schema.String),
  createdAt: Schema.Number,
})
export type WorkflowRun = Schema.Schema.Type<typeof WorkflowRun>

export const decodeWorkflowRun = Schema.decodeUnknownEffect(WorkflowRun)
