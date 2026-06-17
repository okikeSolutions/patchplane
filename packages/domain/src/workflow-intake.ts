import { Schema } from 'effect'
import { Actor } from './actor'
import { ExternalWorkflowRef } from './external-workflow-ref'
import { WorkspaceId } from './ids'
import { PromptRequestSource } from './prompt-request'

export const WorkflowIntake = Schema.Struct({
  actor: Actor,
  workspaceId: WorkspaceId,
  source: PromptRequestSource,
  traceId: Schema.String,
  prompt: Schema.String,
  externalRef: Schema.optional(ExternalWorkflowRef),
})
export type WorkflowIntake = Schema.Schema.Type<typeof WorkflowIntake>

export const decodeWorkflowIntake = Schema.decodeUnknownEffect(WorkflowIntake)
