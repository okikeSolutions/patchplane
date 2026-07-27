import { Clock, Effect, Exit } from 'effect'
import type {
  CandidatePatchSet,
  HumanDecision,
  PublicationResult,
  PublicationResultKind,
} from '@patchplane/domain/decision-review'
import type { PatchReportV1 } from '@patchplane/domain/patch-report-v1'
import type { SandboxExecution } from '@patchplane/domain/sandbox-execution'
import type { WorkflowStart } from '@patchplane/domain/workflow-start'
import {
  decisionCheckConclusion,
  formatDecisionPatchReportComment,
} from '../publication/decision-patch-report'
import {
  SourceControlService,
  type SourcePublicationRef,
} from '../services/source-control-service'
import { StorageService } from '../services/storage-service'
import {
  addCriticalPathBreadcrumb,
  criticalPathBreadcrumbStatuses,
  criticalPathStages,
  type TelemetryContextFields,
  withCriticalPathTransitionOutcome,
} from '../services/telemetry-service'

export interface PublishDecisionToSourceInput extends TelemetryContextFields {
  readonly workflowStart: WorkflowStart
  readonly humanDecision: HumanDecision
  readonly sandboxExecution?: SandboxExecution | undefined
  readonly candidatePatchSet?: CandidatePatchSet | undefined
  readonly patchReport?: PatchReportV1 | undefined
  readonly verification?:
    | {
        readonly status: 'not-configured' | 'incomplete' | 'passed' | 'failed'
        readonly requiredCount: number
        readonly passedCount: number
      }
    | undefined
  readonly publicationResults?: ReadonlyArray<PublicationResult> | undefined
}

export const PublishDecisionToSource = Effect.fn(
  '@patchplane/core/workflows/PublishDecisionToSource',
)(function* (input: PublishDecisionToSourceInput) {
  const ref = input.workflowStart.promptRequest.externalRef
  const provider = ref?.repositoryProvider
  const owner = ref?.repositoryOwner
  const name = ref?.repositoryName
  const installationId = ref?.repositoryInstallationId
  const startedAt = yield* Clock.currentTimeMillis
  const traceId = input.traceId ?? input.workflowStart.workflowRun.traceId
  const storage = yield* StorageService

  if (provider === undefined || owner === undefined || name === undefined) {
    const event = yield* storage.recordProvenanceEvent({
      workflowRunId: input.workflowStart.workflowRun.id,
      traceId,
      type: 'publication',
      operation: 'publishDecisionToSource.missingRepositoryRef',
      ...(input.pluginName === undefined
        ? {}
        : { pluginName: input.pluginName }),
      status: 'blocked',
      startedAt,
      completedAt: yield* Clock.currentTimeMillis,
      summary:
        'Decision publication skipped because no source repository reference is attached.',
      artifactRefs: [input.humanDecision.id],
      idempotencyKey: `${input.humanDecision.id}:publication:missing-repository`,
    })
    return { publications: [], provenanceEvent: event }
  }

  const sourceControl = yield* SourceControlService
  const body = formatDecisionPatchReportComment(input)
  const publicationInputs: Array<{
    readonly kind: PublicationResultKind
    readonly key: string
    readonly publish: Effect.Effect<SourcePublicationRef, unknown>
    readonly summary: string
  }> = []

  if (ref?.issueNumber !== undefined) {
    publicationInputs.push({
      kind: 'issue-comment',
      key: `${input.humanDecision.id}:issue-comment`,
      summary: `Published ${input.humanDecision.status} decision as a GitHub issue comment.`,
      publish: sourceControl.createIssueComment({
        provider,
        ...(installationId === undefined ? {} : { installationId }),
        owner,
        name,
        issueNumber: ref.issueNumber,
        body,
        idempotencyKey: `${input.workflowStart.workflowRun.rootWorkflowRunId ?? input.workflowStart.workflowRun.id}:patch-report`,
        traceId,
        ...(input.pluginName === undefined
          ? {}
          : { pluginName: input.pluginName }),
        operation: 'publishDecisionToSource.createIssueComment',
      }),
    })
  }

  // A GitHub check run is commit-bound. Never attach candidate evidence to
  // the original PR head when the candidate has not been materialized there.
  const headSha = input.candidatePatchSet?.headSha
  if (headSha !== undefined) {
    publicationInputs.push({
      kind: 'check-run',
      key: `${input.humanDecision.id}:check-run`,
      summary: `Published ${input.humanDecision.status} decision as a GitHub check run.`,
      publish: sourceControl.createCheckRun({
        provider,
        ...(installationId === undefined ? {} : { installationId }),
        owner,
        name,
        headSha,
        checkName: 'PatchPlane Review',
        status: 'completed',
        conclusion: decisionCheckConclusion(input),
        title: `PatchPlane: ${input.humanDecision.status}`,
        summary: body,
        ...(ref?.url === undefined ? {} : { detailsUrl: ref.url }),
        idempotencyKey: `${input.candidatePatchSet?.id ?? input.workflowStart.workflowRun.id}:patch-report-check`,
        traceId,
        ...(input.pluginName === undefined
          ? {}
          : { pluginName: input.pluginName }),
        operation: 'publishDecisionToSource.createCheckRun',
      }),
    })
  }

  const publishedKeys = new Set(
    (input.publicationResults ?? []).flatMap((publication) =>
      publication.status === 'published' &&
      publication.idempotencyKey !== undefined
        ? [publication.idempotencyKey]
        : [],
    ),
  )
  const pendingPublications = publicationInputs.filter(
    (publication) => !publishedKeys.has(publication.key),
  )

  const publications = yield* Effect.forEach(
    pendingPublications,
    (publication) =>
      Effect.gen(function* () {
        const evidenceRefs = {
          humanDecisionId: input.humanDecision.id,
          ...(input.candidatePatchSet === undefined
            ? {}
            : { candidatePatchSetId: input.candidatePatchSet.id }),
          ...(publication.kind === 'check-run' && headSha !== undefined
            ? { targetSha: headSha }
            : {}),
        }
        const dispatchToken = `${traceId}:${publication.key}`
        const transitionContext = {
          traceId,
          workflowRunId: input.workflowStart.workflowRun.id,
          pluginName: input.pluginName,
        } as const
        const pending = yield* withCriticalPathTransitionOutcome(
          {
            ...transitionContext,
            operation: 'publishDecisionToSource.claimPublicationResult',
            stage: criticalPathStages.publicationClaim,
          },
          storage.recordPublicationResult({
            ...evidenceRefs,
            workflowRunId: input.workflowStart.workflowRun.id,
            provider,
            kind: publication.kind,
            status: 'pending',
            summary: publication.summary,
            dispatchToken,
            createdAt: yield* Clock.currentTimeMillis,
            idempotencyKey: publication.key,
            traceId,
            ...(input.pluginName === undefined
              ? {}
              : { pluginName: input.pluginName }),
            operation: 'publishDecisionToSource.claimPublicationResult',
          }),
          (claim) =>
            claim.status === 'pending' && claim.dispatchToken === dispatchToken
              ? criticalPathBreadcrumbStatuses.succeeded
              : criticalPathBreadcrumbStatuses.blocked,
        )
        if (
          pending.status === 'published' ||
          pending.dispatchToken !== dispatchToken
        ) {
          return pending
        }

        yield* addCriticalPathBreadcrumb({
          ...transitionContext,
          operation: 'publishDecisionToSource.publishResult',
          stage: criticalPathStages.publicationResult,
          status: criticalPathBreadcrumbStatuses.started,
        })
        const published = yield* publication.publish.pipe(Effect.exit)
        const result = yield* (
          Exit.isSuccess(published)
            ? storage.recordPublicationResult({
                ...evidenceRefs,
                workflowRunId: input.workflowStart.workflowRun.id,
                provider,
                kind: publication.kind,
                status: 'published',
                externalId: published.value.externalId,
                url: published.value.url,
                summary: publication.summary,
                dispatchToken,
                createdAt: yield* Clock.currentTimeMillis,
                idempotencyKey: publication.key,
                traceId,
                ...(input.pluginName === undefined
                  ? {}
                  : { pluginName: input.pluginName }),
                operation: 'publishDecisionToSource.recordPublicationResult',
              })
            : storage.recordPublicationResult({
                ...evidenceRefs,
                workflowRunId: input.workflowStart.workflowRun.id,
                provider,
                kind: publication.kind,
                status: 'failed',
                error: errorMessage(published.cause),
                summary: publication.summary,
                dispatchToken,
                createdAt: yield* Clock.currentTimeMillis,
                idempotencyKey: publication.key,
                traceId,
                ...(input.pluginName === undefined
                  ? {}
                  : { pluginName: input.pluginName }),
                operation: 'publishDecisionToSource.recordPublicationFailure',
              })
        ).pipe(
          Effect.onExit((exit) =>
            Exit.isFailure(exit)
              ? addCriticalPathBreadcrumb({
                  ...transitionContext,
                  operation: 'publishDecisionToSource.publishResult',
                  stage: criticalPathStages.publicationResult,
                  status: criticalPathBreadcrumbStatuses.failed,
                })
              : Effect.void,
          ),
        )
        yield* addCriticalPathBreadcrumb({
          ...transitionContext,
          operation: 'publishDecisionToSource.publishResult',
          stage: criticalPathStages.publicationResult,
          status: Exit.isSuccess(published)
            ? criticalPathBreadcrumbStatuses.succeeded
            : criticalPathBreadcrumbStatuses.failed,
        })
        return result
      }),
  )

  const publicationState = mergePublicationState(
    input.publicationResults ?? [],
    publications,
    new Set(publicationInputs.map((publication) => publication.key)),
  )
  const failedCount = publicationState.filter(
    (publication) => publication.status === 'failed',
  ).length
  const publishedCount = publicationState.filter(
    (publication) => publication.status === 'published',
  ).length
  const provenanceEvent = yield* storage.recordProvenanceEvent({
    workflowRunId: input.workflowStart.workflowRun.id,
    traceId,
    type: 'publication',
    operation: 'publishDecisionToSource',
    ...(input.pluginName === undefined ? {} : { pluginName: input.pluginName }),
    status:
      failedCount === 0 && publishedCount === publicationInputs.length
        ? 'succeeded'
        : 'failed',
    startedAt,
    completedAt: yield* Clock.currentTimeMillis,
    summary: `Published ${publishedCount}/${publicationInputs.length} decision publication targets.`,
    artifactRefs: [
      input.humanDecision.id,
      ...publicationState.map((publication) => publication.id),
    ],
    idempotencyKey: `${input.humanDecision.id}:publication`,
  })

  return { publications, provenanceEvent }
})

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause)
}

function mergePublicationState(
  existing: ReadonlyArray<PublicationResult>,
  attempted: ReadonlyArray<PublicationResult>,
  decisionKeys: ReadonlySet<string>,
) {
  const byKey = new Map<string, PublicationResult>()
  for (const publication of [...existing, ...attempted]) {
    if (
      publication.idempotencyKey !== undefined &&
      decisionKeys.has(publication.idempotencyKey)
    ) {
      byKey.set(publication.idempotencyKey, publication)
    }
  }
  return Array.from(byKey.values())
}
