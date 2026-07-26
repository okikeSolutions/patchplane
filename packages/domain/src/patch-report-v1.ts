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
  VerificationRequirementId,
  VerificationResultId,
  WorkflowRunId,
} from './ids'
import { VerificationCoverageStatus, VerificationPlatform, VerificationResultStatus } from './verification'

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
  key: Schema.String,
  label: Schema.String,
  required: Schema.Boolean,
  resultId: Schema.optional(VerificationResultId),
  status: Schema.optional(VerificationResultStatus),
  command: Schema.optional(Schema.String),
  platform: Schema.optional(VerificationPlatform),
  architecture: Schema.optional(Schema.String),
  artifactIds: Schema.Array(EvidenceArtifactId),
  summary: Schema.optional(Schema.String),
})
export type PatchReportV1Check = Schema.Schema.Type<typeof PatchReportV1Check>

export const PatchReportV1 = Schema.Struct({
  modelVersion: Schema.Literal('v1'),
  id: PatchReportId,
  workflowRunId: WorkflowRunId,
  rootWorkflowRunId: WorkflowRunId,
  parentWorkflowRunId: Schema.optional(WorkflowRunId),
  attemptNumber: Schema.Number,
  repository: Schema.optional(Schema.String),
  sourceCommitSha: Schema.optional(Schema.String),
  requestedChange: Schema.String,
  trustStatus: PatchReportTrustStatus,
  execution: Schema.Struct({
    status: PatchReportExecutionStatus,
    sandboxExecutionId: Schema.optional(SandboxExecutionId),
    provider: Schema.optional(Schema.String),
    command: Schema.optional(Schema.String),
    exitCode: Schema.optional(Schema.Number),
  }),
  candidate: Schema.Struct({
    status: Schema.Literals(['missing', 'empty', 'captured', 'failed']),
    candidatePatchSetId: Schema.optional(CandidatePatchSetId),
    digest: Schema.optional(Schema.String),
    baseSha: Schema.optional(Schema.String),
    headSha: Schema.optional(Schema.String),
    diffArtifactId: Schema.optional(EvidenceArtifactId),
    summary: Schema.optional(Schema.String),
  }),
  verification: Schema.Struct({
    status: VerificationCoverageStatus,
    requiredCount: Schema.Number,
    passedCount: Schema.Number,
    failedRequirementIds: Schema.Array(VerificationRequirementId),
    missingRequirementIds: Schema.Array(VerificationRequirementId),
    checks: Schema.Array(PatchReportV1Check),
  }),
  review: Schema.Struct({
    status: Schema.Literals(['not-run', 'running', 'completed', 'failed']),
    reviewRunId: Schema.optional(ReviewRunId),
    reviewer: Schema.optional(Schema.String),
    findingCount: Schema.Number,
  }),
  policy: Schema.Struct({
    status: Schema.Literals(['not-evaluated', 'approved', 'rejected', 'changes-requested', 'manual-review']),
    policyDecisionId: Schema.optional(PolicyDecisionId),
    policyVersion: Schema.optional(Schema.String),
    inputDigest: Schema.optional(Schema.String),
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
    decidedAt: Schema.optional(Schema.Number),
  }),
  evidence: Schema.Struct({
    artifactCount: Schema.Number,
    artifactIds: Schema.Array(EvidenceArtifactId),
    truncated: Schema.Boolean,
  }),
  publication: Schema.Struct({
    status: Schema.Literals(['not-published', 'pending', 'published', 'failed']),
    resultIds: Schema.Array(PublicationResultId),
  }),
  reasons: Schema.Array(Schema.String),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type PatchReportV1 = Schema.Schema.Type<typeof PatchReportV1>

export const decodePatchReportV1 = Schema.decodeUnknownEffect(PatchReportV1)
