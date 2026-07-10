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
  readonly repositoryExternalId?: string | undefined
  readonly private?: boolean | undefined
}

export interface InstallationAccountRef {
  readonly provider: string
  readonly installationId: string
  readonly accountExternalId: string
  readonly accountLogin: string
  readonly accountType?: string | undefined
}

export interface GetInstallationAccountInput extends TelemetryContextFields {
  readonly provider: string
  readonly installationId?: string
}

export interface ListInstallationRepositoriesInput extends TelemetryContextFields {
  readonly provider: string
  readonly installationId?: string
}

export interface CreateIssueCommentInput extends TelemetryContextFields {
  readonly provider: string
  readonly installationId?: string
  readonly owner: string
  readonly name: string
  readonly issueNumber: number
  readonly body: string
}

export interface SourcePublicationRef {
  readonly externalId?: string | undefined
  readonly url?: string | undefined
}

export interface CreateCheckRunInput extends TelemetryContextFields {
  readonly provider: string
  readonly installationId?: string
  readonly owner: string
  readonly name: string
  readonly headSha: string
  readonly checkName: string
  readonly status: 'completed'
  readonly conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required'
  readonly title: string
  readonly summary: string
  readonly text?: string | undefined
  readonly detailsUrl?: string | undefined
}

export interface CreateDraftPullRequestInput extends TelemetryContextFields {
  readonly provider: string
  readonly installationId?: string
  readonly owner: string
  readonly name: string
  readonly title: string
  readonly head: string
  readonly base: string
  readonly body?: string | undefined
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
  readonly getInstallationAccount: (
    input: GetInstallationAccountInput,
  ) => Effect.Effect<InstallationAccountRef, SourceControlError>
  readonly listInstallationRepositories: (
    input: ListInstallationRepositoriesInput,
  ) => Effect.Effect<ReadonlyArray<RepositoryRef>, SourceControlError>
  readonly createIssueComment: (
    input: CreateIssueCommentInput,
  ) => Effect.Effect<SourcePublicationRef, SourceControlError>
  readonly createCheckRun: (
    input: CreateCheckRunInput,
  ) => Effect.Effect<SourcePublicationRef, SourceControlError>
  readonly createDraftPullRequest: (
    input: CreateDraftPullRequestInput,
  ) => Effect.Effect<SourcePublicationRef, SourceControlError>
  readonly createRepositoryCloneCredentials: (
    input: CreateRepositoryCloneCredentialsInput,
  ) => Effect.Effect<RepositoryCloneCredentials, SourceControlError>
}>()('@patchplane/core/services/SourceControlService') {}
