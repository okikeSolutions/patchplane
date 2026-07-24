import { Effect } from 'effect'
import type { CandidatePatchSet } from '@patchplane/domain/decision-review'
import type { EvidenceArtifact } from '@patchplane/domain/evidence-artifact'
import type { SandboxExecution } from '@patchplane/domain/sandbox-execution'
import type { SandboxVerificationResult } from '../services/sandbox-service'
import { PolicyService } from '../services/policy-service'
import { ReviewService } from '../services/review-service'
import { StorageService } from '../services/storage-service'
import type { TelemetryContextFields } from '../services/telemetry-service'

export interface ProposeMergeDecisionInput extends TelemetryContextFields {
  readonly workflowRunId: string
  readonly sandboxExecution?: SandboxExecution | undefined
  readonly candidatePatchSet?: CandidatePatchSet | undefined
  readonly evidenceArtifacts: ReadonlyArray<EvidenceArtifact>
  readonly verificationResults?: ReadonlyArray<SandboxVerificationResult> | undefined
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

  const policyResult = yield* policy.evaluatePolicy({
    workflowRunId: input.workflowRunId,
    sandboxExecution: input.sandboxExecution,
    reviewFindings: findings,
    traceId: input.traceId,
    pluginName: input.pluginName,
    operation: 'proposeMergeDecision.evaluatePolicy',
  })

  const policyDecision = yield* storage.recordPolicyDecision({
    workflowRunId: input.workflowRunId,
    reviewRunId: reviewRun.id,
    status: policyResult.status,
    summary: policyResult.summary,
    ...(policyResult.reason === undefined ? {} : { reason: policyResult.reason }),
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
