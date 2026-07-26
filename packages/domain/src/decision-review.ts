import { Schema } from 'effect'
import {
  ActorId,
  CandidatePatchSetId,
  EvidenceArtifactId,
  HumanDecisionId,
  PolicyDecisionId,
  ProvenanceEventId,
  PublicationResultId,
  ReviewFindingId,
  ReviewRunId,
  SandboxExecutionId,
  VerificationRequirementId,
  VerificationResultId,
  WorkflowRunId,
} from './ids'

export const CandidatePatchSetStatus = Schema.Literals([
  'captured',
  'empty',
  'failed',
])
export type CandidatePatchSetStatus = Schema.Schema.Type<typeof CandidatePatchSetStatus>

export const CandidatePatchSetStats = Schema.Struct({
  filesChanged: Schema.Number,
  additions: Schema.Number,
  deletions: Schema.Number,
})
export type CandidatePatchSetStats = Schema.Schema.Type<typeof CandidatePatchSetStats>

export const CandidatePatchSet = Schema.Struct({
  id: CandidatePatchSetId,
  workflowRunId: WorkflowRunId,
  sandboxExecutionId: Schema.optional(SandboxExecutionId),
  status: CandidatePatchSetStatus,
  candidateDigest: Schema.optional(Schema.String),
  baseRef: Schema.optional(Schema.String),
  baseSha: Schema.optional(Schema.String),
  headRef: Schema.optional(Schema.String),
  headSha: Schema.optional(Schema.String),
  diffArtifactId: Schema.optional(EvidenceArtifactId),
  summary: Schema.optional(Schema.String),
  stats: Schema.optional(CandidatePatchSetStats),
  idempotencyKey: Schema.optional(Schema.String),
  createdAt: Schema.Number,
})
export type CandidatePatchSet = Schema.Schema.Type<typeof CandidatePatchSet>

export const ReviewRunKind = Schema.Literals([
  'test',
  'lint',
  'policy',
  'manual',
])
export type ReviewRunKind = Schema.Schema.Type<typeof ReviewRunKind>

export const ReviewRunStatus = Schema.Literals([
  'queued',
  'running',
  'completed',
  'failed',
])
export type ReviewRunStatus = Schema.Schema.Type<typeof ReviewRunStatus>

export const ReviewRun = Schema.Struct({
  id: ReviewRunId,
  workflowRunId: WorkflowRunId,
  sandboxExecutionId: Schema.optional(SandboxExecutionId),
  candidatePatchSetId: Schema.optional(CandidatePatchSetId),
  kind: ReviewRunKind,
  reviewer: Schema.String,
  status: ReviewRunStatus,
  summary: Schema.optional(Schema.String),
  externalId: Schema.optional(Schema.String),
  externalUrl: Schema.optional(Schema.String),
  reviewedRevision: Schema.optional(Schema.String),
  startedAt: Schema.Number,
  completedAt: Schema.optional(Schema.Number),
  idempotencyKey: Schema.optional(Schema.String),
  createdAt: Schema.Number,
})
export type ReviewRun = Schema.Schema.Type<typeof ReviewRun>

export const ReviewFindingSeverity = Schema.Literals([
  'info',
  'warning',
  'error',
  'critical',
])
export type ReviewFindingSeverity = Schema.Schema.Type<typeof ReviewFindingSeverity>

export const ReviewFindingCategory = Schema.Literals([
  'test',
  'lint',
  'security',
  'policy',
  'quality',
  'unknown',
])
export type ReviewFindingCategory = Schema.Schema.Type<typeof ReviewFindingCategory>

export const ReviewFinding = Schema.Struct({
  id: ReviewFindingId,
  workflowRunId: WorkflowRunId,
  reviewRunId: Schema.optional(ReviewRunId),
  severity: ReviewFindingSeverity,
  category: ReviewFindingCategory,
  message: Schema.String,
  path: Schema.optional(Schema.String),
  startLine: Schema.optional(Schema.Number),
  endLine: Schema.optional(Schema.Number),
  evidenceArtifactId: Schema.optional(EvidenceArtifactId),
  idempotencyKey: Schema.optional(Schema.String),
  createdAt: Schema.Number,
})
export type ReviewFinding = Schema.Schema.Type<typeof ReviewFinding>

export const DecisionStatus = Schema.Literals([
  'approved',
  'rejected',
  'changes-requested',
])
export type DecisionStatus = Schema.Schema.Type<typeof DecisionStatus>

export const PolicyDecisionStatus = Schema.Literals([
  'approved',
  'rejected',
  'changes-requested',
  'manual-review',
])
export type PolicyDecisionStatus = Schema.Schema.Type<typeof PolicyDecisionStatus>

export const PolicyDecision = Schema.Struct({
  id: PolicyDecisionId,
  workflowRunId: WorkflowRunId,
  reviewRunId: Schema.optional(ReviewRunId),
  candidatePatchSetId: Schema.optional(CandidatePatchSetId),
  status: PolicyDecisionStatus,
  summary: Schema.String,
  reason: Schema.optional(Schema.String),
  policyVersion: Schema.optional(Schema.String),
  inputDigest: Schema.optional(Schema.String),
  verificationResultIds: Schema.optional(Schema.Array(VerificationResultId)),
  reviewFindingIds: Schema.optional(Schema.Array(ReviewFindingId)),
  missingRequirementIds: Schema.optional(Schema.Array(VerificationRequirementId)),
  idempotencyKey: Schema.optional(Schema.String),
  createdAt: Schema.Number,
})
export type PolicyDecision = Schema.Schema.Type<typeof PolicyDecision>

export const HumanDecision = Schema.Struct({
  id: HumanDecisionId,
  workflowRunId: WorkflowRunId,
  sandboxExecutionId: Schema.optional(SandboxExecutionId),
  candidatePatchSetId: Schema.optional(CandidatePatchSetId),
  reviewRunId: Schema.optional(ReviewRunId),
  policyDecisionId: Schema.optional(PolicyDecisionId),
  actorId: ActorId,
  status: DecisionStatus,
  comment: Schema.String,
  verificationOverride: Schema.optional(Schema.Boolean),
  verificationOverrideReason: Schema.optional(Schema.String),
  decidedAt: Schema.Number,
  idempotencyKey: Schema.optional(Schema.String),
})
export type HumanDecision = Schema.Schema.Type<typeof HumanDecision>

export const PublicationResultKind = Schema.Literals([
  'issue-comment',
  'check-run',
  'draft-pull-request',
  'branch',
])
export type PublicationResultKind = Schema.Schema.Type<typeof PublicationResultKind>

export const PublicationResultStatus = Schema.Literals([
  'pending',
  'published',
  'failed',
])
export type PublicationResultStatus = Schema.Schema.Type<typeof PublicationResultStatus>

export const PublicationResult = Schema.Struct({
  id: PublicationResultId,
  workflowRunId: WorkflowRunId,
  humanDecisionId: Schema.optional(HumanDecisionId),
  candidatePatchSetId: Schema.optional(CandidatePatchSetId),
  targetSha: Schema.optional(Schema.String),
  provider: Schema.String,
  kind: PublicationResultKind,
  status: PublicationResultStatus,
  externalId: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  dispatchToken: Schema.optional(Schema.String),
  createdAt: Schema.Number,
  idempotencyKey: Schema.optional(Schema.String),
})
export type PublicationResult = Schema.Schema.Type<typeof PublicationResult>

export const ProvenanceEventStatus = Schema.Literals([
  'started',
  'succeeded',
  'failed',
  'blocked',
])
export type ProvenanceEventStatus = Schema.Schema.Type<typeof ProvenanceEventStatus>

export const ProvenanceEvent = Schema.Struct({
  id: ProvenanceEventId,
  workflowRunId: WorkflowRunId,
  traceId: Schema.String,
  parentEventId: Schema.optional(Schema.String),
  sequence: Schema.Number,
  type: Schema.String,
  operation: Schema.String,
  pluginName: Schema.optional(Schema.String),
  status: ProvenanceEventStatus,
  startedAt: Schema.Number,
  completedAt: Schema.optional(Schema.Number),
  summary: Schema.optional(Schema.String),
  artifactRefs: Schema.Array(Schema.String),
  errorCategory: Schema.optional(Schema.String),
  idempotencyKey: Schema.optional(Schema.String),
})
export type ProvenanceEvent = Schema.Schema.Type<typeof ProvenanceEvent>

export const decodeCandidatePatchSet = Schema.decodeUnknownEffect(CandidatePatchSet)
export const decodeReviewRun = Schema.decodeUnknownEffect(ReviewRun)
export const decodeReviewFinding = Schema.decodeUnknownEffect(ReviewFinding)
export const decodePolicyDecision = Schema.decodeUnknownEffect(PolicyDecision)
export const decodeHumanDecision = Schema.decodeUnknownEffect(HumanDecision)
export const decodePublicationResult = Schema.decodeUnknownEffect(PublicationResult)
export const decodeProvenanceEvent = Schema.decodeUnknownEffect(ProvenanceEvent)
