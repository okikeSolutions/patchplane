import { Schema } from 'effect'
import {
  ActorId,
  CandidatePatchSetId,
  EvidenceArtifactId,
  HumanDecisionId,
  PatchReportId,
  PolicyDecisionId,
  PublicationResultId,
  ReviewFindingId,
  ReviewRunId,
  SandboxExecutionId,
  VerificationExecutionGroupId,
  VerificationPlanId,
  VerificationRequirementId,
  VerificationResultId,
  WorkflowRunId,
} from './ids'
import { VerificationCoverageStatus, VerificationPlatform, VerificationResultStatus } from './verification'
import {
  EpochMillis,
  GitCommitSha,
  NonNegativeInt,
  PositiveInt,
  Sha256Digest,
} from './refinements'

export const PatchReportTrustStatus = Schema.Literals([
  'untrusted',
  'approved',
  'rejected',
  'changes-requested',
  'superseded',
])
export type PatchReportTrustStatus = Schema.Schema.Type<typeof PatchReportTrustStatus>

export const PatchReportExecutionStatus = Schema.Literals([
  'not-run',
  'running',
  'completed',
  'failed',
])
export type PatchReportExecutionStatus = Schema.Schema.Type<typeof PatchReportExecutionStatus>

export const PatchReportV1Check = Schema.Struct({
  requirementId: VerificationRequirementId,
  key: Schema.NonEmptyString,
  label: Schema.NonEmptyString,
  required: Schema.Boolean,
  resultId: Schema.optional(VerificationResultId),
  verificationPlanId: Schema.optional(VerificationPlanId),
  executionGroupId: Schema.optional(VerificationExecutionGroupId),
  status: Schema.optional(VerificationResultStatus),
  command: Schema.optional(Schema.String),
  commandDigest: Schema.optional(Sha256Digest),
  platform: Schema.optional(VerificationPlatform),
  architecture: Schema.optional(Schema.String),
  artifactIds: Schema.Array(EvidenceArtifactId),
  stdoutArtifactId: Schema.optional(EvidenceArtifactId),
  stderrArtifactId: Schema.optional(EvidenceArtifactId),
  cleanupStatus: Schema.optional(
    Schema.Literals(['deleted', 'failed', 'retained', 'not-started']),
  ),
  summary: Schema.optional(Schema.String),
})
export type PatchReportV1Check = Schema.Schema.Type<typeof PatchReportV1Check>

export const PatchReportV1 = Schema.Struct({
  modelVersion: Schema.Literal('v1'),
  id: PatchReportId,
  workflowRunId: WorkflowRunId,
  rootWorkflowRunId: WorkflowRunId,
  parentWorkflowRunId: Schema.optional(WorkflowRunId),
  attemptNumber: PositiveInt,
  repository: Schema.optional(Schema.NonEmptyString),
  sourceCommitSha: Schema.optional(GitCommitSha),
  requestedChange: Schema.NonEmptyString,
  trustStatus: PatchReportTrustStatus,
  execution: Schema.Struct({
    status: PatchReportExecutionStatus,
    sandboxExecutionId: Schema.optional(SandboxExecutionId),
    provider: Schema.optional(Schema.NonEmptyString),
    command: Schema.optional(Schema.NonEmptyString),
    exitCode: Schema.optional(Schema.Int),
  }),
  candidate: Schema.Struct({
    status: Schema.Literals(['missing', 'empty', 'captured', 'failed']),
    candidatePatchSetId: Schema.optional(CandidatePatchSetId),
    digest: Schema.optional(Sha256Digest),
    baseSha: Schema.optional(GitCommitSha),
    headSha: Schema.optional(GitCommitSha),
    diffArtifactId: Schema.optional(EvidenceArtifactId),
    summary: Schema.optional(Schema.String),
  }),
  verification: Schema.Struct({
    status: VerificationCoverageStatus,
    requiredCount: NonNegativeInt,
    passedCount: NonNegativeInt,
    failedRequirementIds: Schema.Array(VerificationRequirementId),
    missingRequirementIds: Schema.Array(VerificationRequirementId),
    checks: Schema.Array(PatchReportV1Check),
  }),
  review: Schema.Struct({
    status: Schema.Literals(['not-run', 'running', 'completed', 'failed']),
    reviewRunId: Schema.optional(ReviewRunId),
    reviewer: Schema.optional(Schema.String),
    findingCount: NonNegativeInt,
  }),
  policy: Schema.Struct({
    status: Schema.Literals(['not-evaluated', 'approved', 'rejected', 'changes-requested', 'manual-review']),
    policyDecisionId: Schema.optional(PolicyDecisionId),
    policyVersion: Schema.optional(Schema.String),
    inputDigest: Schema.optional(Sha256Digest),
    verificationResultIds: Schema.Array(VerificationResultId),
    reviewFindingIds: Schema.Array(ReviewFindingId),
    missingRequirementIds: Schema.Array(VerificationRequirementId),
    summary: Schema.optional(Schema.String),
  }),
  decision: Schema.Struct({
    status: Schema.Literals(['pending', 'approved', 'rejected', 'changes-requested']),
    humanDecisionId: Schema.optional(HumanDecisionId),
    actorId: Schema.optional(ActorId),
    comment: Schema.optional(Schema.String),
    verificationOverride: Schema.optional(Schema.Boolean),
    verificationOverrideReason: Schema.optional(Schema.String),
    decidedAt: Schema.optional(EpochMillis),
  }),
  evidence: Schema.Struct({
    artifactCount: NonNegativeInt,
    artifactIds: Schema.Array(EvidenceArtifactId),
    truncated: Schema.Boolean,
  }),
  publication: Schema.Struct({
    status: Schema.Literals(['not-published', 'pending', 'published', 'failed']),
    resultIds: Schema.Array(PublicationResultId),
  }),
  reasons: Schema.Array(Schema.String),
  createdAt: EpochMillis,
  updatedAt: EpochMillis,
})
export type PatchReportV1 = Schema.Schema.Type<typeof PatchReportV1>

export const decodePatchReportV1 = Schema.decodeUnknownEffect(PatchReportV1)
