import { Clock, Crypto, Effect } from 'effect'
import type { CandidatePatchSet } from '@patchplane/domain/decision-review'
import type { EvidenceArtifact } from '@patchplane/domain/evidence-artifact'
import type { WorkflowRunId } from '@patchplane/domain/ids'
import type { SandboxExecution } from '@patchplane/domain/sandbox-execution'
import type { VerificationRequirement, VerificationResult } from '@patchplane/domain/verification'
import { PolicyService } from '../services/policy-service'
import { ReviewService } from '../services/review-service'
import { StorageService } from '../services/storage-service'
import type { TelemetryContextFields } from '../services/telemetry-service'
import { evaluateVerificationCoverage } from '../verification/evaluate-verification-coverage'

export interface ProposeMergeDecisionInput extends TelemetryContextFields {
  readonly workflowRunId: WorkflowRunId
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
  const startedAt = yield* Clock.currentTimeMillis

  const review = yield* reviewer.runReview(input)
  const completedAt = yield* Clock.currentTimeMillis
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
    idempotencyKey: `${input.candidatePatchSet?.id ?? input.workflowRunId}:review:${review.reviewer}`,
    createdAt: startedAt,
    traceId: input.traceId,
    pluginName: input.pluginName,
    operation: 'proposeMergeDecision.recordReviewRun',
  })

  const findings = yield* Effect.forEach(review.findings.map((finding, index) => ({ finding, index })), ({ finding, index }) =>
    storage.recordReviewFinding({
      workflowRunId: input.workflowRunId,
      reviewRunId: reviewRun.id,
      severity: finding.severity,
      category: finding.category,
      message: finding.message,
      ...(finding.evidenceArtifactId === undefined ? {} : { evidenceArtifactId: finding.evidenceArtifactId }),
      idempotencyKey: `${reviewRun.id}:finding:${index}`,
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

  const policyVersion = 'alpha-v1'
  const policyInputDigest = yield* sha256Json({
    candidatePatchSetId: input.candidatePatchSet?.id,
    reviewRunId: reviewRun.id,
    reviewFindingIds: sortedStrings(findings.map((finding) => finding.id)),
    verificationResultIds: sortedStrings(verificationCoverage.consideredResultIds),
    missingRequirementIds: sortedStrings(verificationCoverage.missingRequirementIds),
    policyVersion,
  })
  const policyDecision = yield* storage.recordPolicyDecision({
    workflowRunId: input.workflowRunId,
    reviewRunId: reviewRun.id,
    ...(input.candidatePatchSet === undefined ? {} : { candidatePatchSetId: input.candidatePatchSet.id }),
    status: policyResult.status,
    summary: policyResult.summary,
    ...(policyResult.reason === undefined ? {} : { reason: policyResult.reason }),
    policyVersion,
    inputDigest: policyInputDigest,
    verificationResultIds: verificationCoverage.consideredResultIds,
    reviewFindingIds: findings.map((finding) => finding.id),
    missingRequirementIds: verificationCoverage.missingRequirementIds,
    idempotencyKey: `${reviewRun.id}:policy:${policyVersion}`,
    createdAt: yield* Clock.currentTimeMillis,
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

const sha256Json = Effect.fnUntraced(function*(value: unknown) {
    const crypto = yield* Crypto.Crypto
    const digest = yield* crypto.digest('SHA-256', utf8Bytes(JSON.stringify(value)))
  return `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
})

function utf8Bytes(value: string) {
  const encoded = encodeURIComponent(value)
  const bytes: Array<number> = []
  for (let index = 0; index < encoded.length; index += 1) {
    const character = encoded[index]
    if (character === '%' && index + 2 < encoded.length) {
      bytes.push(Number.parseInt(encoded.slice(index + 1, index + 3), 16))
      index += 2
    } else if (character !== undefined) {
      bytes.push(character.charCodeAt(0))
    }
  }
  return Uint8Array.from(bytes)
}

function sortedStrings(values: ReadonlyArray<string>) {
  return values.reduce<Array<string>>((sorted, value) => {
    const index = sorted.findIndex((candidate) => value < candidate)
    if (index === -1) return [...sorted, value]
    return [...sorted.slice(0, index), value, ...sorted.slice(index)]
  }, [])
}
