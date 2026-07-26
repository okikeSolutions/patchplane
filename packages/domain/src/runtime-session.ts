import { Schema } from 'effect'
import { RuntimeSessionId, WorkflowRunId } from './ids'
import { EpochMillis } from './refinements'

export const RuntimeSessionStatus = Schema.Literals([
  'starting',
  'running',
  'completed',
  'failed',
  'cancelled',
])
export type RuntimeSessionStatus = Schema.Schema.Type<typeof RuntimeSessionStatus>

export const RuntimeSession = Schema.Struct({
  id: RuntimeSessionId,
  workflowRunId: WorkflowRunId,
  provider: Schema.NonEmptyString,
  sandboxId: Schema.NonEmptyString,
  sessionId: Schema.NonEmptyString,
  commandId: Schema.NonEmptyString,
  status: RuntimeSessionStatus,
  startedAt: EpochMillis,
  updatedAt: EpochMillis,
  completedAt: Schema.optional(EpochMillis),
})
export type RuntimeSession = Schema.Schema.Type<typeof RuntimeSession>

export const decodeRuntimeSession = Schema.decodeUnknownEffect(RuntimeSession)
export const decodeRuntimeSessions = Schema.decodeUnknownEffect(Schema.Array(RuntimeSession))
