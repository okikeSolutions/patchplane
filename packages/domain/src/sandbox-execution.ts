import { Schema } from 'effect'
import { WorkflowRunId } from './ids'

export const SandboxExecutionStatus = Schema.Literals([
  'succeeded',
  'failed',
])
export type SandboxExecutionStatus = Schema.Schema.Type<
  typeof SandboxExecutionStatus
>

export const SandboxExecution = Schema.Struct({
  id: Schema.String,
  workflowRunId: WorkflowRunId,
  provider: Schema.String,
  sandboxId: Schema.String,
  command: Schema.String,
  status: SandboxExecutionStatus,
  exitCode: Schema.optional(Schema.Number),
  stdout: Schema.String,
  stderr: Schema.optional(Schema.String),
  startedAt: Schema.Number,
  completedAt: Schema.Number,
})
export type SandboxExecution = Schema.Schema.Type<typeof SandboxExecution>

export const decodeSandboxExecution = Schema.decodeUnknownEffect(SandboxExecution)
