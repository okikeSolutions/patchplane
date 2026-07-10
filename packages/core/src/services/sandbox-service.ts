import { Context, Effect } from 'effect'
import type { SandboxError, StorageError } from '@patchplane/domain/errors'
import type { SandboxPolicy } from '@patchplane/domain/sandbox-policy'
import type { ArtifactBody, EvidenceArtifactKind } from './artifacts-service'
import type { TelemetryContextFields } from './telemetry-service'

export interface SandboxCommandInput extends TelemetryContextFields {
  readonly repositoryUrl: string
  readonly repositoryFullName: string
  readonly branch?: string | undefined
  readonly commitId?: string | undefined
  readonly command: string
  readonly timeoutSeconds?: number | undefined
  readonly env?: Readonly<Record<string, string>> | undefined
  readonly evidenceTestReportCommand?: string | undefined
  readonly evidenceBrowserScreenshotCommand?: string | undefined
  readonly gitUsername?: string | undefined
  readonly gitPassword?: string | undefined
  readonly traceId: string
}

export interface SandboxRuntimeSessionStarted {
  readonly provider: string
  readonly sandboxId: string
  readonly sessionId: string
  readonly commandId: string
  readonly startedAt: number
}

export interface SandboxAgentInput extends TelemetryContextFields {
  readonly repositoryUrl: string
  readonly repositoryFullName: string
  readonly prompt: string
  readonly provider: string
  readonly model: string
  readonly thinking?: string | undefined
  readonly mode?: 'json' | 'rpc' | undefined
  readonly branch?: string | undefined
  readonly commitId?: string | undefined
  readonly timeoutSeconds?: number | undefined
  readonly evidenceTestReportCommand?: string | undefined
  readonly evidenceBrowserScreenshotCommand?: string | undefined
  readonly gitUsername?: string | undefined
  readonly gitPassword?: string | undefined
  readonly traceId: string
  readonly onRuntimeSessionStarted?: (
    session: SandboxRuntimeSessionStarted,
  ) => Effect.Effect<void, SandboxError | StorageError>
  readonly onRuntimeEvents?: (
    events: ReadonlyArray<SandboxRuntimeEvent>,
  ) => Effect.Effect<void, SandboxError | StorageError>
}

export interface SandboxRuntimeEvent {
  readonly provider: string
  readonly type: string
  readonly occurredAt: number
  readonly summary?: string | undefined
  readonly payloadJson?: string | undefined
  readonly idempotencyKey?: string | undefined
  readonly sourceSessionId?: string | undefined
  readonly sourceCommandId?: string | undefined
  readonly sourceStream?: 'stdout' | 'stderr' | undefined
  readonly sourceLine?: number | undefined
  readonly sourceOffset?: number | undefined
}

export interface SandboxEvidenceArtifact {
  readonly kind: EvidenceArtifactKind
  readonly label?: string | undefined
  readonly contentType: string
  readonly body: ArtifactBody
  readonly retentionPolicy?: string | undefined
}

export interface SandboxCommandResult {
  readonly provider: string
  readonly sandboxId: string
  readonly sessionId?: string | undefined
  readonly commandId?: string | undefined
  readonly command: string
  readonly exitCode: number | undefined
  readonly stdout: string
  readonly stderr?: string | undefined
  readonly policy?: SandboxPolicy | undefined
  readonly runtimeEvents?: ReadonlyArray<SandboxRuntimeEvent> | undefined
  readonly evidenceArtifacts?: ReadonlyArray<SandboxEvidenceArtifact> | undefined
  readonly startedAt: number
  readonly completedAt: number
}

export interface SandboxRuntimeControlInput extends TelemetryContextFields {
  readonly sandboxId: string
  readonly sessionId: string
  readonly commandId: string
  readonly message?: string | undefined
  readonly traceId: string
}

export interface SandboxRuntimeControlResult {
  readonly provider: string
  readonly sandboxId: string
  readonly sessionId: string
  readonly commandId: string
  readonly status: 'sent' | 'terminated'
}

export class SandboxService extends Context.Service<SandboxService, {
  readonly runRepositoryAgent: (
    input: SandboxAgentInput,
  ) => Effect.Effect<SandboxCommandResult, SandboxError>
  readonly runRepositoryCommand: (
    input: SandboxCommandInput,
  ) => Effect.Effect<SandboxCommandResult, SandboxError>
  readonly abortRuntimeSession: (
    input: SandboxRuntimeControlInput,
  ) => Effect.Effect<SandboxRuntimeControlResult, SandboxError>
  readonly steerRuntimeSession: (
    input: SandboxRuntimeControlInput & { readonly message: string },
  ) => Effect.Effect<SandboxRuntimeControlResult, SandboxError>
  readonly followUpRuntimeSession: (
    input: SandboxRuntimeControlInput & { readonly message: string },
  ) => Effect.Effect<SandboxRuntimeControlResult, SandboxError>
  readonly terminateRuntimeSession: (
    input: SandboxRuntimeControlInput,
  ) => Effect.Effect<SandboxRuntimeControlResult, SandboxError>
}>()('@patchplane/core/services/SandboxService') {}
