import { Context, Effect } from 'effect'
import type { SandboxError } from '@patchplane/domain/errors'

export interface SandboxCommandInput {
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

export interface SandboxAgentInput {
  readonly repositoryUrl: string
  readonly repositoryFullName: string
  readonly prompt: string
  readonly provider: string
  readonly model: string
  readonly apiKey?: string | undefined
  readonly branch?: string | undefined
  readonly commitId?: string | undefined
  readonly timeoutSeconds?: number | undefined
  readonly gitUsername?: string | undefined
  readonly gitPassword?: string | undefined
  readonly traceId: string
}

export interface SandboxCommandResult {
  readonly provider: string
  readonly sandboxId: string
  readonly command: string
  readonly exitCode: number | undefined
  readonly stdout: string
  readonly stderr?: string | undefined
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
