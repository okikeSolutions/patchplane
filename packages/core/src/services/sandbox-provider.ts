import { Context, type Effect, type Option } from 'effect'
import type {
  ChangeRequestId,
  SandboxCleanupError,
  SandboxExecutionError,
  SandboxId,
  VerificationAttemptId,
} from '@patchplane/domain'
import type { ValidatedSandboxEnv } from './sandbox-credential-policy'

export interface SandboxSummary {
  readonly sandboxId: SandboxId
  readonly state: string
  readonly labels: Readonly<Record<string, string>>
}

export interface SandboxExecOutput {
  readonly exitCode: number
  readonly output: string
}

export interface SandboxProviderService {
  readonly createSandbox: (input: {
    readonly attemptId: VerificationAttemptId
    readonly changeRequestId: ChangeRequestId
    readonly labels: Readonly<Record<string, string>>
    readonly env: ValidatedSandboxEnv
    readonly autoDeleteIntervalMinutes?: number
  }) => Effect.Effect<SandboxSummary, SandboxExecutionError>

  readonly execCommand: (input: {
    readonly sandboxId: SandboxId
    readonly command: string
    readonly timeoutMs?: number
  }) => Effect.Effect<SandboxExecOutput, SandboxExecutionError>

  readonly getSandbox: (
    sandboxId: SandboxId,
  ) => Effect.Effect<Option.Option<SandboxSummary>, SandboxExecutionError>

  readonly listSandboxesByLabels: (
    labels: Readonly<Record<string, string>>,
  ) => Effect.Effect<ReadonlyArray<SandboxSummary>, SandboxExecutionError>

  readonly deleteSandbox: (input: {
    readonly sandboxId: SandboxId
    readonly attemptId: VerificationAttemptId
  }) => Effect.Effect<void, SandboxCleanupError>
}

export class SandboxProvider extends Context.Service<
  SandboxProvider,
  SandboxProviderService
>()('@patchplane/core/SandboxProvider') {}
