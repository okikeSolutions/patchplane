import { Effect } from 'effect'
import type { SandboxExecution } from '@patchplane/domain/sandbox-execution'
import type { WorkflowStart } from '@patchplane/domain/workflow-start'
import { formatSandboxResultComment } from '../publication/sandbox-result-comment'
import { SourceControlService } from '../services/source-control-service'

export const PublishSandboxResultToSource = Effect.fn(
  '@patchplane/core/workflows/PublishSandboxResultToSource',
)(function*(input: {
  readonly workflowStart: WorkflowStart
  readonly sandboxExecution: SandboxExecution | undefined
}) {
  const ref = input.workflowStart.promptRequest.externalRef
  const execution = input.sandboxExecution

  if (
    execution === undefined ||
    ref?.repositoryProvider === undefined ||
    ref.repositoryOwner === undefined ||
    ref.repositoryName === undefined ||
    ref.issueNumber === undefined
  ) {
    return undefined
  }

  const sourceControl = yield* SourceControlService
  const body = formatSandboxResultComment({
    workflowStart: input.workflowStart,
    sandboxExecution: execution,
  })

  yield* sourceControl.createIssueComment({
    provider: ref.repositoryProvider,
    ...(ref.repositoryInstallationId === undefined
      ? {}
      : { installationId: ref.repositoryInstallationId }),
    owner: ref.repositoryOwner,
    name: ref.repositoryName,
    issueNumber: ref.issueNumber,
    body,
  })

  return { provider: ref.repositoryProvider, issueNumber: ref.issueNumber }
})
