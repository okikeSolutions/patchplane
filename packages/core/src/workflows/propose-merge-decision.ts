import { Effect } from 'effect'
import type { CandidatePatchSet } from '@patchplane/domain/decision-review'
import type { EvidenceArtifact } from '@patchplane/domain/evidence-artifact'
import type { SandboxExecution } from '@patchplane/domain/sandbox-execution'
import type { VerificationRequirement, VerificationResult } from '@patchplane/domain/verification'
import { PolicyService } from '../services/policy-service'
import { ReviewService } from '../services/review-service'
import { StorageService } from '../services/storage-service'
import type { TelemetryContextFields } from '../services/telemetry-service'
import { evaluateVerificationCoverage } from '../verification/evaluate-verification-coverage'

export interface ProposeMergeDecisionInput extends TelemetryContextFields {
  readonly workflowRunId: string
  readonly sandboxExecution?: SandboxExecution | undefined
  readonly candidatePatchSet?: CandidatePatchSet | undefined
  readonly evidenceArtifacts: ReadonlyArray<EvidenceArtifact>
  readonly verificationRequirements?: ReadonlyArray<VerificationRequirement> | undefined
  readonly verificationResults?: ReadonlyArray<VerificationResult> | undefined
}

export const ProposeMergeDecision = Effect.fn(
  '@patchplane/core/workflows/ProposeMergeDecision',
)(function*(input: ProposeMergeDecisionInput) {
  const storage = yield* StorageService
  const reviewer = yield* ReviewService
  const policy = yield* PolicyService
  const startedAt = Date.now()

  const review = yield* reviewer.runReview(input)
  const completedAt = Date.now()
  const reviewRun = yield* storage.recordReviewRun({
    workflowRunId: input.workflowRunId,
    ...(input.sandboxExecution === undefined ? {} : { sandboxExecutionId: input.sandboxExecution.id }),
    ...(input.candidatePatchSet === undefined ? {} : { candidatePatchSetId: input.candidatePatchSet.id }),
    kind: review.kind,
    reviewer: review.reviewer,
    status: 'completed',
    summary: review.summary,
    startedAt,
    completedAt,
    createdAt: startedAt,
    traceId: input.traceId,
    pluginName: input.pluginName,
    operation: 'proposeMergeDecision.recordReviewRun',
  })

  const findings = yield* Effect.forEach(review.findings, (finding) =>
    storage.recordReviewFinding({
      workflowRunId: input.workflowRunId,
      reviewRunId: reviewRun.id,
      severity: finding.severity,
      category: finding.category,
      message: finding.message,
      ...(finding.evidenceArtifactId === undefined ? {} : { evidenceArtifactId: finding.evidenceArtifactId }),
      createdAt: completedAt,
      traceId: input.traceId,
      pluginName: input.pluginName,
      operation: 'proposeMergeDecision.recordReviewFinding',
    })
  )

  const verificationCoverage = input.candidatePatchSet === undefined
    ? {
      status: 'incomplete' as const,
      requiredCount: 0,
      passedCount: 0,
      failedRequirementIds: [],
      missingRequirementIds: [],
      consideredResultIds: [],
    }
    : evaluateVerificationCoverage({
      candidatePatchSetId: input.candidatePatchSet.id,
      requirements: input.verificationRequirements ?? [],
      results: input.verificationResults ?? [],
    })
  const policyResult = yield* policy.evaluatePolicy({
    workflowRunId: input.workflowRunId,
    sandboxExecution: input.sandboxExecution,
    candidatePatchSet: input.candidatePatchSet,
    verificationCoverage,
    reviewFindings: findings,
    traceId: input.traceId,
    pluginName: input.pluginName,
    operation: 'proposeMergeDecision.evaluatePolicy',
  })

  const policyDecision = yield* storage.recordPolicyDecision({
    workflowRunId: input.workflowRunId,
    reviewRunId: reviewRun.id,
    ...(input.candidatePatchSet === undefined ? {} : { candidatePatchSetId: input.candidatePatchSet.id }),
    status: policyResult.status,
    summary: policyResult.summary,
    ...(policyResult.reason === undefined ? {} : { reason: policyResult.reason }),
    policyVersion: 'alpha-v1',
    verificationResultIds: verificationCoverage.consideredResultIds,
    missingRequirementIds: verificationCoverage.missingRequirementIds,
    createdAt: Date.now(),
    traceId: input.traceId,
    pluginName: input.pluginName,
    operation: 'proposeMergeDecision.recordPolicyDecision',
  })

  return {
    reviewRun,
    findings,
    policyDecision,
  }
})
