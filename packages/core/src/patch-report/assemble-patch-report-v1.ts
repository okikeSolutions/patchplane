import { Data, Effect } from 'effect'
import type {
  CandidatePatchSet,
  HumanDecision,
  PolicyDecision,
  PublicationResult,
  ReviewFinding,
  ReviewRun,
} from '@patchplane/domain/decision-review'
import type { EvidenceArtifact } from '@patchplane/domain/evidence-artifact'
import { decodePatchReportV1 } from '@patchplane/domain/patch-report-v1'
import type { SandboxExecution } from '@patchplane/domain/sandbox-execution'
import type { VerificationRequirement, VerificationResult } from '@patchplane/domain/verification'
import { makePatchReportId } from '@patchplane/domain/ids'
import type { WorkflowStart } from '@patchplane/domain/workflow-start'
import { evaluateVerificationCoverage } from '../verification/evaluate-verification-coverage'

export class PatchReportAssemblyError extends Data.TaggedError('PatchReportAssemblyError')<{
  readonly message: string
}> {}

export interface AssemblePatchReportV1Input {
  readonly workflowStart: WorkflowStart
  readonly sandboxExecutions: ReadonlyArray<SandboxExecution>
  readonly candidatePatchSets: ReadonlyArray<CandidatePatchSet>
  readonly verificationRequirements: ReadonlyArray<VerificationRequirement>
  readonly verificationResults: ReadonlyArray<VerificationResult>
  readonly reviewRuns: ReadonlyArray<ReviewRun>
  readonly reviewFindings: ReadonlyArray<ReviewFinding>
  readonly policyDecisions: ReadonlyArray<PolicyDecision>
  readonly humanDecisions: ReadonlyArray<HumanDecision>
  readonly evidenceArtifacts: ReadonlyArray<EvidenceArtifact>
  readonly publicationResults: ReadonlyArray<PublicationResult>
  readonly trustDataTruncated: boolean
  readonly evidenceTruncated?: boolean | undefined
}

/** Builds one coherent report graph for a single V1 workflow attempt. */
export const AssemblePatchReportV1 = Effect.fn(
  '@patchplane/core/patch-report/AssemblePatchReportV1',
)(function*(input: AssemblePatchReportV1Input) {
  const run = input.workflowStart.workflowRun
  if (run.modelVersion !== 'v1') {
    return yield* new PatchReportAssemblyError({
      message: 'Legacy workflow evidence cannot be assembled as a V1 Patch Report',
    })
  }
  const execution = latest(
    input.sandboxExecutions.filter((item) => item.workflowRunId === run.id),
    (item) => item.completedAt,
  )
  const candidate = latest(
    input.candidatePatchSets.filter((item) =>
      item.workflowRunId === run.id &&
      (item.subject?.kind === 'incoming-pull-request' ||
        (execution !== undefined && item.sandboxExecutionId === execution.id))
    ),
    (item) => item.createdAt,
  )
  const requirements = input.verificationRequirements.filter((item) => item.workflowRunId === run.id)
  const allCandidateResults = candidate === undefined
    ? []
    : input.verificationResults.filter((item) => item.candidatePatchSetId === candidate.id)
  const review = candidate === undefined
    ? undefined
    : latest(
      input.reviewRuns.filter((item) =>
        item.candidatePatchSetId === candidate.id &&
        (execution === undefined || item.sandboxExecutionId === execution.id)
      ),
      (item) => item.createdAt,
    )
  const policy = review === undefined
    ? undefined
    : latest(
      input.policyDecisions.filter((item) =>
        item.reviewRunId === review.id &&
        (item.candidatePatchSetId === undefined || item.candidatePatchSetId === candidate?.id)
      ),
      (item) => item.createdAt,
    )
  // Once policy is persisted, its explicit result references are the immutable
  // decision-time verification snapshot. Later results cannot silently upgrade
  // or downgrade an existing human decision.
  const candidateResults = policy?.verificationResultIds === undefined
    ? allCandidateResults
    : allCandidateResults.filter((result) => policy.verificationResultIds?.includes(result.id) === true)
  const coverage = candidate === undefined
    ? emptyCoverage(requirements.length === 0 ? 'not-configured' : 'incomplete')
    : evaluateVerificationCoverage({
      candidatePatchSetId: candidate.id,
      requirements,
      results: candidateResults,
    })
  const effectiveCoverage = input.trustDataTruncated
    ? {
      ...coverage,
      status: 'incomplete' as const,
      passedCount: 0,
      missingRequirementIds: requirements.filter((item) => item.required).map((item) => item.id),
    }
    : coverage
  const decision = policy === undefined || input.trustDataTruncated
    ? undefined
    : latest(
      input.humanDecisions.filter((item) =>
        item.candidatePatchSetId === candidate?.id &&
        item.sandboxExecutionId === execution?.id &&
        item.reviewRunId === review?.id &&
        item.policyDecisionId === policy.id
      ),
      (item) => item.decidedAt,
    )
  const publications = decision === undefined
    ? []
    : input.publicationResults.filter((item) =>
      item.humanDecisionId === decision.id || item.idempotencyKey?.startsWith(`${decision.id}:`) === true
    )
  const reasons = reportReasons({
    execution,
    candidate,
    coverage: effectiveCoverage,
    review,
    policy,
    decision,
    trustDataTruncated: input.trustDataTruncated,
  })

  return yield* decodePatchReportV1({
    modelVersion: 'v1',
    id: makePatchReportId(`patch-report:v1:${run.id}`),
    workflowRunId: run.id,
    rootWorkflowRunId: run.rootWorkflowRunId ?? run.id,
    ...(run.parentWorkflowRunId === undefined ? {} : { parentWorkflowRunId: run.parentWorkflowRunId }),
    attemptNumber: run.attemptNumber ?? 1,
    ...(input.workflowStart.promptRequest.externalRef?.repositoryFullName === undefined
      ? {}
      : { repository: input.workflowStart.promptRequest.externalRef.repositoryFullName }),
    ...(run.sourceCommitSha === undefined ? {} : { sourceCommitSha: run.sourceCommitSha }),
    requestedChange: summarize(input.workflowStart.promptRequest.prompt),
    trustStatus: trustStatus(decision),
    execution: execution === undefined
      ? { status: 'not-run' }
      : {
        status: execution.status === 'succeeded' ? 'completed' : 'failed',
        sandboxExecutionId: execution.id,
        provider: execution.provider,
        command: execution.command,
        ...(execution.exitCode === undefined ? {} : { exitCode: execution.exitCode }),
      },
    candidate: candidate === undefined
      ? { status: 'missing' }
      : {
        status: candidate.status,
        candidatePatchSetId: candidate.id,
        ...(candidate.candidateDigest === undefined ? {} : { digest: candidate.candidateDigest }),
        ...(candidate.baseSha === undefined ? {} : { baseSha: candidate.baseSha }),
        ...(candidate.headSha === undefined ? {} : { headSha: candidate.headSha }),
        ...(candidate.diffArtifactId === undefined ? {} : { diffArtifactId: candidate.diffArtifactId }),
        ...(candidate.summary === undefined ? {} : { summary: candidate.summary }),
      },
    verification: {
      status: effectiveCoverage.status,
      requiredCount: effectiveCoverage.requiredCount,
      passedCount: effectiveCoverage.passedCount,
      failedRequirementIds: effectiveCoverage.failedRequirementIds,
      missingRequirementIds: effectiveCoverage.missingRequirementIds,
      checks: requirements.map((requirement) => {
        const result = latest(
          candidateResults.filter((item) => item.requirementId === requirement.id),
          (item) => item.completedAt ?? item.startedAt,
        )
        return {
          requirementId: requirement.id,
          key: requirement.key,
          label: requirement.label,
          required: requirement.required,
          ...(result === undefined ? {} : { resultId: result.id, status: result.status }),
          ...(result?.verificationPlanId === undefined ? {} : { verificationPlanId: result.verificationPlanId }),
          ...(result?.executionGroupId === undefined ? {} : { executionGroupId: result.executionGroupId }),
          ...((result?.command ?? requirement.command) === undefined
            ? {}
            : { command: result?.command ?? requirement.command }),
          ...(result?.commandDigest === undefined ? {} : { commandDigest: result.commandDigest }),
          ...((result?.platform ?? requirement.platform) === undefined
            ? {}
            : { platform: result?.platform ?? requirement.platform }),
          ...((result?.architecture ?? requirement.architecture) === undefined
            ? {}
            : { architecture: result?.architecture ?? requirement.architecture }),
          artifactIds: result?.artifactIds ?? [],
          ...(result?.stdoutArtifactId === undefined ? {} : { stdoutArtifactId: result.stdoutArtifactId }),
          ...(result?.stderrArtifactId === undefined ? {} : { stderrArtifactId: result.stderrArtifactId }),
          ...(result?.cleanupStatus === undefined ? {} : { cleanupStatus: result.cleanupStatus }),
          ...(result?.summary === undefined ? {} : { summary: result.summary }),
        }
      }),
    },
    review: review === undefined
      ? { status: 'not-run', findingCount: 0 }
      : {
        status: review.status === 'queued' || review.status === 'running'
          ? 'running'
          : review.status,
        reviewRunId: review.id,
        reviewer: review.reviewer,
        findingCount: input.reviewFindings.filter((item) => item.reviewRunId === review.id).length,
      },
    policy: policy === undefined
      ? { status: 'not-evaluated', verificationResultIds: [], reviewFindingIds: [], missingRequirementIds: [] }
      : {
        status: policy.status,
        policyDecisionId: policy.id,
        ...(policy.policyVersion === undefined ? {} : { policyVersion: policy.policyVersion }),
        ...(policy.inputDigest === undefined ? {} : { inputDigest: policy.inputDigest }),
        verificationResultIds: policy.verificationResultIds ?? [],
        reviewFindingIds: policy.reviewFindingIds ?? [],
        missingRequirementIds: policy.missingRequirementIds ?? [],
        summary: policy.summary,
      },
    decision: decision === undefined
      ? { status: 'pending' }
      : {
        status: decision.status,
        humanDecisionId: decision.id,
        actorId: decision.actorId,
        comment: decision.comment,
        ...(decision.verificationOverride === undefined ? {} : { verificationOverride: decision.verificationOverride }),
        ...(decision.verificationOverrideReason === undefined
          ? {}
          : { verificationOverrideReason: decision.verificationOverrideReason }),
        decidedAt: decision.decidedAt,
      },
    evidence: {
      artifactCount: input.evidenceArtifacts.length,
      artifactIds: input.evidenceArtifacts.map((artifact) => artifact.id),
      truncated: input.evidenceTruncated ?? false,
    },
    publication: {
      status: publicationStatus(publications),
      resultIds: publications.map((publication) => publication.id),
    },
    reasons,
    createdAt: run.createdAt,
    updatedAt: Math.max(
      run.createdAt,
      execution?.completedAt ?? 0,
      candidate?.createdAt ?? 0,
      ...candidateResults.map((item) => item.completedAt ?? item.startedAt),
      review?.completedAt ?? review?.createdAt ?? 0,
      policy?.createdAt ?? 0,
      decision?.decidedAt ?? 0,
      ...publications.map((item) => item.createdAt),
    ),
  })
})

function latest<A>(items: ReadonlyArray<A>, timestamp: (item: A) => number): A | undefined {
  return items.reduce<A | undefined>(
    (current, item) => current === undefined || timestamp(item) > timestamp(current) ? item : current,
    undefined,
  )
}

function emptyCoverage(status: 'not-configured' | 'incomplete') {
  return {
    status,
    requiredCount: 0,
    passedCount: 0,
    failedRequirementIds: [],
    missingRequirementIds: [],
    consideredResultIds: [],
  }
}

function trustStatus(decision: HumanDecision | undefined) {
  return decision?.status ?? 'untrusted'
}

function publicationStatus(publications: ReadonlyArray<PublicationResult>) {
  if (publications.some((item) => item.status === 'failed')) return 'failed' as const
  if (publications.some((item) => item.status === 'pending')) return 'pending' as const
  if (publications.some((item) => item.status === 'published')) return 'published' as const
  return 'not-published' as const
}

function reportReasons(input: {
  readonly execution: SandboxExecution | undefined
  readonly candidate: CandidatePatchSet | undefined
  readonly coverage: ReturnType<typeof evaluateVerificationCoverage> | ReturnType<typeof emptyCoverage>
  readonly review: ReviewRun | undefined
  readonly policy: PolicyDecision | undefined
  readonly decision: HumanDecision | undefined
  readonly trustDataTruncated: boolean
}) {
  return [
    ...(input.trustDataTruncated ? ['report:trust-data-truncated'] : []),
    ...(input.execution === undefined ? ['execution:not-run'] : []),
    ...(input.execution?.status === 'failed' ? ['execution:failed'] : []),
    ...(input.candidate?.status !== 'captured' ? ['candidate:not-captured'] : []),
    ...(input.coverage.status === 'not-configured' ? ['verification:not-configured'] : []),
    ...(input.coverage.status === 'incomplete' ? ['verification:incomplete'] : []),
    ...(input.coverage.status === 'failed' ? ['verification:failed'] : []),
    ...(input.review === undefined ? ['review:not-run'] : []),
    ...(input.policy === undefined ? ['policy:not-evaluated'] : []),
    ...(input.decision === undefined ? ['decision:pending'] : []),
    ...(input.decision?.verificationOverride === true ? ['decision:verification-override'] : []),
  ]
}

function summarize(value: string) {
  const collapsed = value.trim().replace(/\s+/g, ' ')
  return collapsed.length <= 500 ? collapsed : `${collapsed.slice(0, 497)}...`
}
