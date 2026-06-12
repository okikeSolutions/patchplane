import { Schema } from 'effect'
import { PromptRequest } from './prompt-request'
import { WorkflowRun } from './workflow-run'

export const WorkflowStart = Schema.Struct({
  promptRequest: PromptRequest,
  workflowRun: WorkflowRun,
})
export type WorkflowStart = Schema.Schema.Type<typeof WorkflowStart>

export const decodeWorkflowStart = Schema.decodeUnknownEffect(WorkflowStart)
export const decodeWorkflowStarts = Schema.decodeUnknownEffect(
  Schema.Array(WorkflowStart),
)
