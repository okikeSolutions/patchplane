import { Context, Effect } from 'effect'
import type { SandboxError } from '@patchplane/domain/errors'
import type { SandboxPolicy } from '@patchplane/domain/sandbox-policy'
import type { TelemetryContextFields } from './telemetry-service'

export interface SandboxCommandInput extends TelemetryContextFields {
  readonly repositoryUrl: string
  readonly repositoryFullName: string
  readonly branch?: string | undefined
  readonly commitId?: string | undefined
  readonly command: string
  readonly timeoutSeconds?: number | undefined
  readonly env?: Readonly<Record<string, string>> | undefined
  readonly gitUsername?: string | undefined
  readonly gitPassword?: string | undefined
  readonly traceId: string
}

export interface SandboxAgentInput extends TelemetryContextFields {
  readonly repositoryUrl: string
  readonly repositoryFullName: string
  readonly prompt: string
  readonly provider: string
  readonly model: string
  readonly thinking?: string | undefined
  readonly apiKey?: string | undefined
  readonly env?: Readonly<Record<string, string>> | undefined
  readonly branch?: string | undefined
  readonly commitId?: string | undefined
  readonly timeoutSeconds?: number | undefined
  readonly gitUsername?: string | undefined
  readonly gitPassword?: string | undefined
  readonly traceId: string
}

export interface SandboxRuntimeEvent {
  readonly provider: string
  readonly type: string
  readonly occurredAt: number
  readonly summary?: string | undefined
  readonly payloadJson?: string | undefined
}

export interface SandboxCommandResult {
  readonly provider: string
  readonly sandboxId: string
  readonly command: string
  readonly exitCode: number | undefined
  readonly stdout: string
  readonly stderr?: string | undefined
  readonly policy?: SandboxPolicy | undefined
  readonly runtimeEvents?: ReadonlyArray<SandboxRuntimeEvent> | undefined
  readonly startedAt: number
  readonly completedAt: number
}

export class SandboxService extends Context.Service<SandboxService, {
  readonly runRepositoryAgent: (
    input: SandboxAgentInput,
  ) => Effect.Effect<SandboxCommandResult, SandboxError>
  readonly runRepositoryCommand: (
    input: SandboxCommandInput,
  ) => Effect.Effect<SandboxCommandResult, SandboxError>
}>()('@patchplane/core/services/SandboxService') {}
