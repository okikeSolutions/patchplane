import { Context, Effect } from 'effect'
import type { SourceControlError } from '@patchplane/domain/errors'
import type { TelemetryContextFields } from './telemetry-service'

export interface VerifyRepositoryAccessInput extends TelemetryContextFields {
  readonly provider: string
  readonly installationId?: string
  readonly owner: string
  readonly name: string
}

export interface RepositoryRef {
  readonly provider: string
  readonly installationId?: string
  readonly owner: string
  readonly name: string
  readonly fullName: string
}

export interface CreateIssueCommentInput extends TelemetryContextFields {
  readonly provider: string
  readonly installationId?: string
  readonly owner: string
  readonly name: string
  readonly issueNumber: number
  readonly body: string
}

export interface CreateRepositoryCloneCredentialsInput extends TelemetryContextFields {
  readonly provider: string
  readonly installationId?: string
  readonly owner: string
  readonly name: string
  readonly repositoryExternalId?: string | undefined
}

export interface RepositoryCloneCredentials {
  readonly username: string
  readonly password: string
}

export class SourceControlService extends Context.Service<SourceControlService, {
  readonly verifyRepositoryAccess: (
    input: VerifyRepositoryAccessInput,
  ) => Effect.Effect<RepositoryRef, SourceControlError>
  readonly createIssueComment: (
    input: CreateIssueCommentInput,
  ) => Effect.Effect<void, SourceControlError>
  readonly createRepositoryCloneCredentials: (
    input: CreateRepositoryCloneCredentialsInput,
  ) => Effect.Effect<RepositoryCloneCredentials, SourceControlError>
}>()('@patchplane/core/services/SourceControlService') {}
