import { Schema } from 'effect'

export const RuntimeControlOperation = Schema.Literals([
  'abort',
  'steer',
  'followUp',
  'terminate',
])
export type RuntimeControlOperation = Schema.Schema.Type<typeof RuntimeControlOperation>

export const RuntimeControlInput = Schema.Struct({
  workflowRunId: Schema.String,
  operation: RuntimeControlOperation,
  message: Schema.optional(Schema.String),
})
export type RuntimeControlInput = Schema.Schema.Type<typeof RuntimeControlInput>

export const RuntimeControlResultStatus = Schema.Literals([
  'sent',
  'terminated',
  'no_active_session',
  'missing_message',
])
export type RuntimeControlResultStatus = Schema.Schema.Type<typeof RuntimeControlResultStatus>

export const RuntimeControlResult = Schema.Struct({
  status: RuntimeControlResultStatus,
})
export type RuntimeControlResult = Schema.Schema.Type<typeof RuntimeControlResult>
