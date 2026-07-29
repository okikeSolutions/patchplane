import { Schema } from 'effect'
import {
  SandboxExecutionId,
  VerificationExecutionGroupId,
  WorkflowRunId,
} from './ids'
import { EpochMillis, ProviderProcessId } from './refinements'
import { SandboxPolicy } from './sandbox-policy'

export const SandboxExecutionStatus = Schema.Literals(['succeeded', 'failed'])
export type SandboxExecutionStatus = Schema.Schema.Type<
  typeof SandboxExecutionStatus
>

/**
 * Result of executing repository work in an isolated sandbox.
 *
 * @remarks
 * Sandbox executions capture command output and timing without exposing the
 * sandbox provider's native response shape to core workflow consumers.
 */
export const SandboxExecution = Schema.Struct({
  id: SandboxExecutionId,
  workflowRunId: WorkflowRunId,
  executionGroupId: Schema.optional(VerificationExecutionGroupId),
  idempotencyKey: Schema.optional(Schema.NonEmptyString),
  provider: Schema.NonEmptyString,
  sandboxId: Schema.NonEmptyString,
  providerSessionId: Schema.optional(ProviderProcessId),
  providerCommandId: Schema.optional(ProviderProcessId),
  command: Schema.NonEmptyString,
  status: SandboxExecutionStatus,
  exitCode: Schema.optional(Schema.Int),
  stdout: Schema.String,
  stderr: Schema.optional(Schema.String),
  policy: Schema.optional(SandboxPolicy),
  startedAt: EpochMillis,
  completedAt: EpochMillis,
})
export type SandboxExecution = Schema.Schema.Type<typeof SandboxExecution>

export const decodeSandboxExecution =
  Schema.decodeUnknownEffect(SandboxExecution)
