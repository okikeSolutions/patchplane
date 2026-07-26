import { Effect } from 'effect'
import type { WorkflowStart } from '@patchplane/domain/workflow-start'
import { SourceControlService } from '../services/source-control-service'

export interface PreparedRepositoryClone {
  readonly repositoryUrl: string
  readonly repositoryFullName: string
  readonly branch?: string | undefined
  readonly commitId?: string | undefined
  readonly gitUsername?: string | undefined
  readonly gitPassword?: string | undefined
}

export const PrepareRepositoryClone = Effect.fn(
  '@patchplane/core/repository/PrepareRepositoryClone',
)(function*(workflowStart: WorkflowStart) {
  const ref = workflowStart.promptRequest.externalRef

  if (ref?.repositoryFullName === undefined) {
    return undefined
  }

  const sourceCommitSha = workflowStart.workflowRun.modelVersion === 'v1'
    ? workflowStart.workflowRun.sourceCommitSha
    : workflowStart.workflowRun.sourceCommitSha ?? ref.pullRequestHeadSha
  if (workflowStart.workflowRun.modelVersion === 'v1' && sourceCommitSha === undefined) {
    return undefined
  }
  const clone = {
    repositoryUrl: `https://github.com/${ref.repositoryFullName}.git`,
    repositoryFullName: ref.repositoryFullName,
    ...(ref.pullRequestHeadRef === undefined ? {} : { branch: ref.pullRequestHeadRef }),
    ...(sourceCommitSha === undefined ? {} : { commitId: sourceCommitSha }),
  }

  if (
    ref.repositoryProvider === undefined ||
    ref.repositoryOwner === undefined ||
    ref.repositoryName === undefined
  ) {
    return clone
  }

  const sourceControl = yield* SourceControlService
  const credentials = yield* sourceControl.createRepositoryCloneCredentials({
    provider: ref.repositoryProvider,
    ...(ref.repositoryInstallationId === undefined
      ? {}
      : { installationId: ref.repositoryInstallationId }),
    owner: ref.repositoryOwner,
    name: ref.repositoryName,
    ...(ref.repositoryExternalId === undefined
      ? {}
      : { repositoryExternalId: ref.repositoryExternalId }),
  })

  return {
    ...clone,
    gitUsername: credentials.username,
    gitPassword: credentials.password,
  }
})
