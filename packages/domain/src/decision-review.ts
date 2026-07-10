import { Schema } from 'effect'
import { ActorId, WorkflowRunId } from './ids'

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
  id: Schema.String,
  workflowRunId: WorkflowRunId,
  status: CandidatePatchSetStatus,
  baseRef: Schema.optional(Schema.String),
  baseSha: Schema.optional(Schema.String),
  headRef: Schema.optional(Schema.String),
  headSha: Schema.optional(Schema.String),
  diffArtifactId: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String),
  stats: Schema.optional(CandidatePatchSetStats),
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
  id: Schema.String,
  workflowRunId: WorkflowRunId,
  kind: ReviewRunKind,
  reviewer: Schema.String,
  status: ReviewRunStatus,
  summary: Schema.optional(Schema.String),
  startedAt: Schema.Number,
  completedAt: Schema.optional(Schema.Number),
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
  id: Schema.String,
  workflowRunId: WorkflowRunId,
  reviewRunId: Schema.optional(Schema.String),
  severity: ReviewFindingSeverity,
  category: ReviewFindingCategory,
  message: Schema.String,
  path: Schema.optional(Schema.String),
  startLine: Schema.optional(Schema.Number),
  endLine: Schema.optional(Schema.Number),
  evidenceArtifactId: Schema.optional(Schema.String),
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
  id: Schema.String,
  workflowRunId: WorkflowRunId,
  reviewRunId: Schema.optional(Schema.String),
  status: PolicyDecisionStatus,
  summary: Schema.String,
  reason: Schema.optional(Schema.String),
  createdAt: Schema.Number,
})
export type PolicyDecision = Schema.Schema.Type<typeof PolicyDecision>

export const HumanDecision = Schema.Struct({
  id: Schema.String,
  workflowRunId: WorkflowRunId,
  actorId: ActorId,
  status: DecisionStatus,
  comment: Schema.String,
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
  id: Schema.String,
  workflowRunId: WorkflowRunId,
  provider: Schema.String,
  kind: PublicationResultKind,
  status: PublicationResultStatus,
  externalId: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
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
  id: Schema.String,
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
