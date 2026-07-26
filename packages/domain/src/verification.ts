import { Schema } from 'effect'
import { EvidenceArtifactKind } from './evidence-artifact'
import {
  CandidatePatchSetId,
  EvidenceArtifactId,
  SandboxExecutionId,
  VerificationRequirementId,
  VerificationResultId,
  WorkflowRunId,
} from './ids'
import { EpochMillis, NonNegativeInt, Sha256Digest } from './refinements'

/** A repository or policy expectation that must be evaluated for one candidate. */
export const VerificationRequirementKind = Schema.Literals([
  'test',
  'lint',
  'build',
  'browser',
  'security',
  'review',
])
export type VerificationRequirementKind = Schema.Schema.Type<typeof VerificationRequirementKind>

export const VerificationRequirementSource = Schema.Literals([
  'repository-config',
  'intake',
  'policy',
  'human',
])
export type VerificationRequirementSource = Schema.Schema.Type<typeof VerificationRequirementSource>

export const VerificationPlatform = Schema.Literals(['linux', 'windows', 'macos'])
export type VerificationPlatform = Schema.Schema.Type<typeof VerificationPlatform>

export const VerificationRequirement = Schema.Struct({
  id: VerificationRequirementId,
  workflowRunId: WorkflowRunId,
  key: Schema.NonEmptyString,
  label: Schema.NonEmptyString,
  kind: VerificationRequirementKind,
  required: Schema.Boolean,
  command: Schema.optional(Schema.String),
  platform: Schema.optional(VerificationPlatform),
  architecture: Schema.optional(Schema.NonEmptyString),
  requiredArtifactKinds: Schema.Array(EvidenceArtifactKind),
  source: VerificationRequirementSource,
  createdAt: EpochMillis,
})
export type VerificationRequirement = Schema.Schema.Type<typeof VerificationRequirement>

/**
 * Result of one verifier invocation against one immutable candidate.
 *
 * `passed` is valid only when the command exited successfully, required
 * artifacts were captured, and pre/post candidate digests match.
 */
export const VerificationResultStatus = Schema.Literals([
  'queued',
  'running',
  'passed',
  'failed',
  'error',
  'blocked',
  'cancelled',
  'skipped',
  'invalidated',
])
export type VerificationResultStatus = Schema.Schema.Type<typeof VerificationResultStatus>

export const VerificationResult = Schema.Struct({
  id: VerificationResultId,
  workflowRunId: WorkflowRunId,
  requirementId: VerificationRequirementId,
  candidatePatchSetId: CandidatePatchSetId,
  sandboxExecutionId: Schema.optional(SandboxExecutionId),
  provider: Schema.NonEmptyString,
  command: Schema.optional(Schema.String),
  platform: VerificationPlatform,
  architecture: Schema.NonEmptyString,
  environmentImage: Schema.optional(Schema.NonEmptyString),
  status: VerificationResultStatus,
  exitCode: Schema.optional(Schema.Int),
  summary: Schema.optional(Schema.String),
  passedCount: Schema.optional(NonNegativeInt),
  failedCount: Schema.optional(NonNegativeInt),
  skippedCount: Schema.optional(NonNegativeInt),
  artifactIds: Schema.Array(EvidenceArtifactId),
  producedArtifactKinds: Schema.Array(EvidenceArtifactKind),
  candidateDigestBefore: Schema.optional(Sha256Digest),
  candidateDigestAfter: Schema.optional(Sha256Digest),
  startedAt: EpochMillis,
  completedAt: Schema.optional(EpochMillis),
  idempotencyKey: Schema.optional(Schema.NonEmptyString),
})
export type VerificationResult = Schema.Schema.Type<typeof VerificationResult>

export const VerificationCoverageStatus = Schema.Literals([
  'not-configured',
  'incomplete',
  'passed',
  'failed',
])
export type VerificationCoverageStatus = Schema.Schema.Type<typeof VerificationCoverageStatus>

export const decodeVerificationRequirement = Schema.decodeUnknownEffect(VerificationRequirement)
export const decodeVerificationResult = Schema.decodeUnknownEffect(VerificationResult)
export const decodeVerificationRequirements = Schema.decodeUnknownEffect(Schema.Array(VerificationRequirement))
export const decodeVerificationResults = Schema.decodeUnknownEffect(Schema.Array(VerificationResult))
