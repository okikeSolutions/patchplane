import { Schema } from 'effect'

export const runtimeSessionStatuses = [
  'queued',
  'launching',
  'running',
  'completed',
  'failed',
  'terminated',
] as const

export const RuntimeSessionStatusSchema = Schema.Literal(
  ...runtimeSessionStatuses,
)
export type RuntimeSessionStatus = Schema.Schema.Type<
  typeof RuntimeSessionStatusSchema
>

export const runtimeEventTypes = [
  'session.created',
  'session.started',
  'session.completed',
  'session.failed',
  'turn.started',
  'tool.called',
  'artifact.emitted',
  'turn.completed',
  'turn.failed',
] as const

export const RuntimeEventTypeSchema = Schema.Literal(...runtimeEventTypes)
export type RuntimeEventType = Schema.Schema.Type<typeof RuntimeEventTypeSchema>

export const RuntimeSessionSchema = Schema.Struct({
  id: Schema.String,
  workflowRunId: Schema.String,
  externalSessionId: Schema.optional(Schema.String),
  sandboxProvider: Schema.String,
  runtimeProvider: Schema.String,
  status: RuntimeSessionStatusSchema,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  startedAt: Schema.optional(Schema.Number),
  endedAt: Schema.optional(Schema.Number),
})

export type RuntimeSession = Schema.Schema.Type<typeof RuntimeSessionSchema>

export const RuntimeEventSchema = Schema.Struct({
  id: Schema.String,
  requestId: Schema.String,
  workflowRunId: Schema.optional(Schema.String),
  runtimeSessionId: Schema.optional(Schema.String),
  type: RuntimeEventTypeSchema,
  message: Schema.String,
  createdAt: Schema.Number,
})
export type RuntimeEvent = Schema.Schema.Type<typeof RuntimeEventSchema>
