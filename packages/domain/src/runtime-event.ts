import { Schema } from 'effect'
import { WorkflowRunId } from './ids'

/**
 * Event emitted by an agent/runtime while processing a workflow run.
 *
 * @remarks
 * Payloads are persisted as JSON strings so storage plugins can keep a stable
 * schema while providers evolve their detailed event shapes independently.
 */
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
