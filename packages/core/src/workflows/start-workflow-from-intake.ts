import { Effect } from 'effect'
import { WorkflowStateError } from '@patchplane/domain/errors'
import type { WorkflowIntake } from '@patchplane/domain/workflow-intake'
import { SourceControlService } from '../services/source-control-service'
import { StorageService } from '../services/storage-service'
import {
  addCriticalPathBreadcrumb,
  criticalPathBreadcrumbStatuses,
  criticalPathStages,
  withCriticalPathTransition,
} from '../services/telemetry-service'

export type StartWorkflowFromIntakeInput = WorkflowIntake

export const StartWorkflowFromIntake = Effect.fn(
  '@patchplane/core/workflows/StartWorkflowFromIntake',
)(function* (input: StartWorkflowFromIntakeInput) {
  yield* Effect.annotateCurrentSpan({
    traceId: input.traceId,
    actorId: input.actor.id,
    workspaceId: input.workspaceId,
    source: input.source,
    externalProvider: input.externalRef?.provider,
    externalEventKind: input.externalRef?.eventKind,
  })

  if (
    input.source === 'external' &&
    (input.externalRef?.pullRequestHeadSha === undefined ||
      input.externalRef.pullRequestHeadSha.trim().length === 0)
  ) {
    return yield* new WorkflowStateError({
      message: 'External workflow intake requires a pinned source commit SHA',
    })
  }

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

  yield* addCriticalPathBreadcrumb({
    traceId: input.traceId,
    operation: 'startWorkflowFromIntake.acceptIntake',
    stage: criticalPathStages.intakeAccepted,
    status: criticalPathBreadcrumbStatuses.succeeded,
  })

  const storage = yield* StorageService
  const result = yield* withCriticalPathTransition(
    {
      traceId: input.traceId,
      operation: 'startWorkflowFromIntake.createAttempt',
      stage: criticalPathStages.attemptCreated,
    },
    storage.createWorkflowFromIntake(input),
  )

  yield* Effect.logInfo('Started workflow from generic intake', {
    promptRequestId: result.promptRequest.id,
    workflowRunId: result.workflowRun.id,
    externalProvider: input.externalRef?.provider,
  })

  return result
})
