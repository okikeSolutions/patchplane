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

export const RuntimeEventInputSchema = Schema.Struct({
  requestId: Schema.String,
  workflowRunId: Schema.optional(Schema.String),
  runtimeSessionId: Schema.optional(Schema.String),
  type: RuntimeEventTypeSchema,
  message: Schema.String,
  createdAt: Schema.Number,
})
export type RuntimeEventInput = Schema.Schema.Type<
  typeof RuntimeEventInputSchema
>

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

export const RuntimeEnvironmentSchema = Schema.Record({
  key: Schema.String,
  value: Schema.String,
})
export type RuntimeEnvironment = Schema.Schema.Type<
  typeof RuntimeEnvironmentSchema
>

export const RuntimeExecutionRequestSchema = Schema.Struct({
  promptRequestId: Schema.String,
  session: RuntimeSessionSchema,
  prompt: Schema.String,
  workingDirectory: Schema.String,
  env: RuntimeEnvironmentSchema,
})
export type RuntimeExecutionRequest = Schema.Schema.Type<
  typeof RuntimeExecutionRequestSchema
>

export const RuntimeExecutionPlanSchema = Schema.Struct({
  command: Schema.String,
  workingDirectory: Schema.String,
  env: RuntimeEnvironmentSchema,
})
export type RuntimeExecutionPlan = Schema.Schema.Type<
  typeof RuntimeExecutionPlanSchema
>

export const RuntimeExecutionOutputSchema = Schema.Struct({
  exitCode: Schema.Number,
  stdout: Schema.String,
  stderr: Schema.String,
})
export type RuntimeExecutionOutput = Schema.Schema.Type<
  typeof RuntimeExecutionOutputSchema
>

export const SandboxGitCredentialsSchema = Schema.Struct({
  username: Schema.String,
  password: Schema.String,
})
export type SandboxGitCredentials = Schema.Schema.Type<
  typeof SandboxGitCredentialsSchema
>

export const SandboxExecutionRequestSchema = Schema.Struct({
  promptRequestId: Schema.String,
  session: RuntimeSessionSchema,
  prompt: Schema.String,
  repoUrl: Schema.String,
  baseBranch: Schema.String,
  targetBranch: Schema.String,
  workingDirectory: Schema.String,
  env: RuntimeEnvironmentSchema,
  gitCredentials: Schema.optional(SandboxGitCredentialsSchema),
})
export type SandboxExecutionRequest = Schema.Schema.Type<
  typeof SandboxExecutionRequestSchema
>

export const SandboxExecutionResultSchema = Schema.Struct({
  externalSessionId: Schema.String,
  events: Schema.Array(RuntimeEventInputSchema),
})
export type SandboxExecutionResult = Schema.Schema.Type<
  typeof SandboxExecutionResultSchema
>
