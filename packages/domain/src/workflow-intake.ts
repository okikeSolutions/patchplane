import { Schema } from 'effect'
import { Actor } from './actor'
import { ExternalWorkflowRef } from './external-workflow-ref'
import { WorkspaceId } from './ids'
import { PromptRequestSource } from './prompt-request'

/**
 * Provider-neutral request to start a PatchPlane workflow.
 *
 * @remarks
 * External providers such as GitHub are normalized into this shape before core
 * workflow logic runs. Core code should depend on this schema rather than
 * provider-specific webhook payloads.
 */
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
