import { Context, Effect } from 'effect'
import type { SourceControlError } from '@patchplane/domain/errors'

export interface VerifyRepositoryAccessInput {
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

export interface CreateIssueCommentInput {
  readonly provider: string
  readonly installationId?: string
  readonly owner: string
  readonly name: string
  readonly issueNumber: number
  readonly body: string
}

export class SourceControlService extends Context.Service<SourceControlService, {
  readonly verifyRepositoryAccess: (
    input: VerifyRepositoryAccessInput,
  ) => Effect.Effect<RepositoryRef, SourceControlError>
  readonly createIssueComment: (
    input: CreateIssueCommentInput,
  ) => Effect.Effect<void, SourceControlError>
}>()('@patchplane/core/services/SourceControlService') {}
