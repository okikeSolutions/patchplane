import { Effect } from 'effect'
import type { WorkflowIntake } from '@patchplane/domain/workflow-intake'
import { SourceControlService } from '../services/source-control-service'
import { StorageService } from '../services/storage-service'

export type StartWorkflowFromIntakeInput = WorkflowIntake

function repositoryAccessInput(externalRef: WorkflowIntake['externalRef']) {
  if (
    externalRef?.repositoryProvider === undefined ||
    externalRef.repositoryOwner === undefined ||
    externalRef.repositoryName === undefined
  ) {
    return undefined
  }

  return {
    provider: externalRef.repositoryProvider,
    ...(externalRef.repositoryInstallationId === undefined
      ? {}
      : { installationId: externalRef.repositoryInstallationId }),
    owner: externalRef.repositoryOwner,
    name: externalRef.repositoryName,
  }
}

export const StartWorkflowFromIntake = Effect.fn(
  '@patchplane/core/workflows/StartWorkflowFromIntake',
)(function*(input: StartWorkflowFromIntakeInput) {
  yield* Effect.annotateCurrentSpan({
    traceId: input.traceId,
    actorId: input.actor.id,
    workspaceId: input.workspaceId,
    source: input.source,
    externalProvider: input.externalRef?.provider,
    externalEventKind: input.externalRef?.eventKind,
  })

  const accessInput = repositoryAccessInput(input.externalRef)
  if (accessInput !== undefined) {
    const sourceControl = yield* SourceControlService
    yield* sourceControl.verifyRepositoryAccess(accessInput)
  }

  const storage = yield* StorageService
  const result = yield* storage.createWorkflowFromIntake(input)

  yield* Effect.logInfo('Started workflow from generic intake', {
    promptRequestId: result.promptRequest.id,
    workflowRunId: result.workflowRun.id,
    externalProvider: input.externalRef?.provider,
  })

  return result
})
