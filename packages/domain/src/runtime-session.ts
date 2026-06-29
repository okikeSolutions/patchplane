import { Schema } from 'effect'
import { WorkflowRunId } from './ids'

export const RuntimeSessionStatus = Schema.Literals([
  'starting',
  'running',
  'completed',
  'failed',
  'cancelled',
])
export type RuntimeSessionStatus = Schema.Schema.Type<typeof RuntimeSessionStatus>

export const RuntimeSession = Schema.Struct({
  id: Schema.String,
  workflowRunId: WorkflowRunId,
  provider: Schema.String,
  sandboxId: Schema.String,
  sessionId: Schema.String,
  commandId: Schema.String,
  status: RuntimeSessionStatus,
  startedAt: Schema.Number,
  updatedAt: Schema.Number,
  completedAt: Schema.optional(Schema.Number),
})
export type RuntimeSession = Schema.Schema.Type<typeof RuntimeSession>

export const decodeRuntimeSession = Schema.decodeUnknownEffect(RuntimeSession)
export const decodeRuntimeSessions = Schema.decodeUnknownEffect(Schema.Array(RuntimeSession))
