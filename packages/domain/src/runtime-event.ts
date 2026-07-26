import { Schema } from 'effect'
import { RuntimeEventId, WorkflowRunId } from './ids'
import { EpochMillis, NonNegativeInt, PositiveInt } from './refinements'

/**
 * Event emitted by an agent/runtime while processing a workflow run.
 *
 * @remarks
 * Payloads are persisted as JSON strings so storage plugins can keep a stable
 * schema while providers evolve their detailed event shapes independently.
 */
export const RuntimeEvent = Schema.Struct({
  id: RuntimeEventId,
  workflowRunId: WorkflowRunId,
  provider: Schema.NonEmptyString,
  type: Schema.NonEmptyString,
  occurredAt: EpochMillis,
  summary: Schema.optional(Schema.String),
  payloadJson: Schema.optional(Schema.String),
  idempotencyKey: Schema.optional(Schema.NonEmptyString),
  sourceSessionId: Schema.optional(Schema.NonEmptyString),
  sourceCommandId: Schema.optional(Schema.NonEmptyString),
  sourceStream: Schema.optional(Schema.Literals(['stdout', 'stderr'])),
  sourceLine: Schema.optional(PositiveInt),
  sourceOffset: Schema.optional(NonNegativeInt),
})
export type RuntimeEvent = Schema.Schema.Type<typeof RuntimeEvent>

export const decodeRuntimeEvent = Schema.decodeUnknownEffect(RuntimeEvent)
export const decodeRuntimeEvents = Schema.decodeUnknownEffect(Schema.Array(RuntimeEvent))
