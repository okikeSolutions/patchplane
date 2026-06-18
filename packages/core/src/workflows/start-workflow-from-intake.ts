import { Effect } from 'effect'
import type { WorkflowIntake } from '@patchplane/domain/workflow-intake'
import { SourceControlService } from '../services/source-control-service'
import { StorageService } from '../services/storage-service'

export type StartWorkflowFromIntakeInput = WorkflowIntake

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

  if (
    input.externalRef?.repositoryProvider !== undefined &&
    input.externalRef.repositoryOwner !== undefined &&
    input.externalRef.repositoryName !== undefined
  ) {
    const sourceControl = yield* SourceControlService
    yield* sourceControl.verifyRepositoryAccess({
      provider: input.externalRef.repositoryProvider,
      ...(input.externalRef.repositoryInstallationId === undefined
        ? {}
        : { installationId: input.externalRef.repositoryInstallationId }),
      owner: input.externalRef.repositoryOwner,
      name: input.externalRef.repositoryName,
    })
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
