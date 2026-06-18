import { Schema } from 'effect'
import { WorkflowRunId } from './ids'

export const RuntimeEvent = Schema.Struct({
  id: Schema.String,
  workflowRunId: WorkflowRunId,
  provider: Schema.String,
  type: Schema.String,
  occurredAt: Schema.Number,
  summary: Schema.optional(Schema.String),
  payloadJson: Schema.optional(Schema.String),
})
export type RuntimeEvent = Schema.Schema.Type<typeof RuntimeEvent>

export const decodeRuntimeEvent = Schema.decodeUnknownEffect(RuntimeEvent)
export const decodeRuntimeEvents = Schema.decodeUnknownEffect(Schema.Array(RuntimeEvent))
