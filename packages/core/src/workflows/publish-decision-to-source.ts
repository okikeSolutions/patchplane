import { Effect, Exit } from 'effect'
import type {
  CandidatePatchSet,
  HumanDecision,
  PublicationResult,
  PublicationResultKind,
} from '@patchplane/domain/decision-review'
import type { SandboxExecution } from '@patchplane/domain/sandbox-execution'
import type { WorkflowStart } from '@patchplane/domain/workflow-start'
import { decisionCheckConclusion, formatDecisionPatchReportComment } from '../publication/decision-patch-report'
import { SourceControlService, type SourcePublicationRef } from '../services/source-control-service'
import { StorageService } from '../services/storage-service'
import type { TelemetryContextFields } from '../services/telemetry-service'

export interface PublishDecisionToSourceInput extends TelemetryContextFields {
  readonly workflowStart: WorkflowStart
  readonly humanDecision: HumanDecision
  readonly sandboxExecution?: SandboxExecution | undefined
  readonly candidatePatchSet?: CandidatePatchSet | undefined
  readonly publicationResults?: ReadonlyArray<PublicationResult> | undefined
}

export const PublishDecisionToSource = Effect.fn(
  '@patchplane/core/workflows/PublishDecisionToSource',
)(function*(input: PublishDecisionToSourceInput) {
  const ref = input.workflowStart.promptRequest.externalRef
  const provider = ref?.repositoryProvider
  const owner = ref?.repositoryOwner
  const name = ref?.repositoryName
  const installationId = ref?.repositoryInstallationId
  const startedAt = Date.now()
  const traceId = input.traceId ?? input.workflowStart.workflowRun.traceId
  const storage = yield* StorageService

  if (provider === undefined || owner === undefined || name === undefined) {
    const event = yield* storage.recordProvenanceEvent({
      workflowRunId: input.workflowStart.workflowRun.id,
      traceId,
      type: 'publication',
      operation: 'publishDecisionToSource.missingRepositoryRef',
      ...(input.pluginName === undefined ? {} : { pluginName: input.pluginName }),
      status: 'blocked',
      startedAt,
      completedAt: Date.now(),
      summary: 'Decision publication skipped because no source repository reference is attached.',
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
        traceId,
        ...(input.pluginName === undefined ? {} : { pluginName: input.pluginName }),
        operation: 'publishDecisionToSource.createIssueComment',
      }),
    })
  }

  const headSha = input.candidatePatchSet?.headSha ?? ref?.pullRequestHeadSha
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
        traceId,
        ...(input.pluginName === undefined ? {} : { pluginName: input.pluginName }),
        operation: 'publishDecisionToSource.createCheckRun',
      }),
    })
  }

  const publishedKeys = new Set(
    (input.publicationResults ?? [])
      .flatMap((publication) =>
        publication.status === 'published' && publication.idempotencyKey !== undefined
          ? [publication.idempotencyKey]
          : []
      ),
  )
  const pendingPublications = publicationInputs.filter((publication) => !publishedKeys.has(publication.key))

  const publications = yield* Effect.forEach(pendingPublications, (publication) =>
    Effect.gen(function* () {
      const published = yield* publication.publish.pipe(Effect.exit)
      if (Exit.isSuccess(published)) {
        return yield* storage.recordPublicationResult({
          workflowRunId: input.workflowStart.workflowRun.id,
          provider,
          kind: publication.kind,
          status: 'published',
          externalId: published.value.externalId,
          url: published.value.url,
          summary: publication.summary,
          createdAt: Date.now(),
          idempotencyKey: publication.key,
          traceId,
          ...(input.pluginName === undefined ? {} : { pluginName: input.pluginName }),
          operation: 'publishDecisionToSource.recordPublicationResult',
        })
      }

      return yield* storage.recordPublicationResult({
        workflowRunId: input.workflowStart.workflowRun.id,
        provider,
        kind: publication.kind,
        status: 'failed',
        error: errorMessage(published.cause),
        summary: publication.summary,
        createdAt: Date.now(),
        idempotencyKey: publication.key,
        traceId,
        ...(input.pluginName === undefined ? {} : { pluginName: input.pluginName }),
        operation: 'publishDecisionToSource.recordPublicationFailure',
      })
    }),
  )

  const failedCount = publications.filter((publication) => publication.status === 'failed').length
  const provenanceEvent = yield* storage.recordProvenanceEvent({
    workflowRunId: input.workflowStart.workflowRun.id,
    traceId,
    type: 'publication',
    operation: 'publishDecisionToSource',
    ...(input.pluginName === undefined ? {} : { pluginName: input.pluginName }),
    status: failedCount === 0 ? 'succeeded' : 'failed',
    startedAt,
    completedAt: Date.now(),
    summary: `Published ${publications.length - failedCount}/${publications.length} decision publication targets.`,
    artifactRefs: [
      input.humanDecision.id,
      ...publications.map((publication) => publication.id),
    ],
    idempotencyKey: `${input.humanDecision.id}:publication`,
  })

  return { publications, provenanceEvent }
})

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause)
}
