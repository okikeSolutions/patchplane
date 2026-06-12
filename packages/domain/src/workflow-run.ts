import { Schema } from 'effect'
import { PromptRequestId, WorkflowRunId, WorkspaceId } from './ids'

export const WorkflowStatus = Schema.Literals(['queued', 'running', 'reviewed'])
export type WorkflowStatus = Schema.Schema.Type<typeof WorkflowStatus>

export const WorkflowRun = Schema.Struct({
  id: WorkflowRunId,
  promptRequestId: PromptRequestId,
  workspaceId: WorkspaceId,
  traceId: Schema.String,
  status: WorkflowStatus,
  createdAt: Schema.Number,
})
export type WorkflowRun = Schema.Schema.Type<typeof WorkflowRun>

export const decodeWorkflowRun = Schema.decodeUnknownEffect(WorkflowRun)
