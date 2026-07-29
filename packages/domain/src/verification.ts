import { Schema } from 'effect'
import { EvidenceArtifactKind } from './evidence-artifact'
import {
  CandidatePatchSetId,
  EvidenceArtifactId,
  SandboxExecutionId,
  VerificationExecutionGroupId,
  VerificationPlanId,
  VerificationRequirementId,
  VerificationResultId,
  WorkflowRunId,
  WorkspaceId,
} from './ids'
import {
  EpochMillis,
  GitCommitSha,
  NonNegativeInt,
  ProviderProcessId,
  Sha256Digest,
} from './refinements'

export const VerificationPlanSourceKind = Schema.Literals([
  'deployment-system',
  'workspace-policy',
  'base-repository-policy',
])
export type VerificationPlanSourceKind = Schema.Schema.Type<
  typeof VerificationPlanSourceKind
>

export const VerificationPlanSource = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('deployment-system'),
    revision: Schema.NonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal('workspace-policy'),
    workspaceId: WorkspaceId,
    revision: Schema.NonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal('base-repository-policy'),
    repositoryFullName: Schema.NonEmptyString,
    baseSha: GitCommitSha,
    revision: Schema.NonEmptyString,
  }),
])
export type VerificationPlanSource = Schema.Schema.Type<
  typeof VerificationPlanSource
>

/** A repository or policy expectation that must be evaluated for one candidate. */
export const VerificationRequirementKind = Schema.Literals([
  'test',
  'lint',
  'build',
  'browser',
  'security',
  'review',
])
export type VerificationRequirementKind = Schema.Schema.Type<
  typeof VerificationRequirementKind
>

export const VerificationRequirementSource = Schema.Literals([
  'repository-config',
  'intake',
  'policy',
  'human',
])
export type VerificationRequirementSource = Schema.Schema.Type<
  typeof VerificationRequirementSource
>

export const VerificationPlatform = Schema.Literals([
  'linux',
  'windows',
  'macos',
])
export type VerificationPlatform = Schema.Schema.Type<
  typeof VerificationPlatform
>

export const VerificationPlanRequirementV1 = Schema.Struct({
  key: Schema.NonEmptyString,
  label: Schema.NonEmptyString,
  kind: VerificationRequirementKind,
  required: Schema.Boolean,
  command: Schema.optional(Schema.NonEmptyString),
  platform: Schema.optional(VerificationPlatform),
  architecture: Schema.optional(Schema.NonEmptyString),
  timeoutSeconds: Schema.optional(NonNegativeInt),
  requiredArtifactKinds: Schema.Array(EvidenceArtifactKind),
})
export type VerificationPlanRequirementV1 = Schema.Schema.Type<
  typeof VerificationPlanRequirementV1
>

export const VerificationPlanV1 = Schema.Struct({
  id: VerificationPlanId,
  workflowRunId: WorkflowRunId,
  version: Schema.Literal('verification-plan-v1'),
  sources: Schema.Array(VerificationPlanSource),
  requirements: Schema.Array(VerificationPlanRequirementV1),
  digest: Sha256Digest,
  createdAt: EpochMillis,
})
export type VerificationPlanV1 = Schema.Schema.Type<typeof VerificationPlanV1>

export const VerificationRequirement = Schema.Struct({
  id: VerificationRequirementId,
  workflowRunId: WorkflowRunId,
  verificationPlanId: Schema.optional(VerificationPlanId),
  key: Schema.NonEmptyString,
  label: Schema.NonEmptyString,
  kind: VerificationRequirementKind,
  required: Schema.Boolean,
  command: Schema.optional(Schema.String),
  platform: Schema.optional(VerificationPlatform),
  architecture: Schema.optional(Schema.NonEmptyString),
  timeoutSeconds: Schema.optional(NonNegativeInt),
  requiredArtifactKinds: Schema.Array(EvidenceArtifactKind),
  source: VerificationRequirementSource,
  createdAt: EpochMillis,
})
export type VerificationRequirement = Schema.Schema.Type<
  typeof VerificationRequirement
>

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
export type VerificationResultStatus = Schema.Schema.Type<
  typeof VerificationResultStatus
>

export const VerificationExecutionGroupStatus = Schema.Literals([
  'claimed',
  'running',
  'completed',
  'failed',
  'blocked',
  'cancelled',
])
export type VerificationExecutionGroupStatus = Schema.Schema.Type<
  typeof VerificationExecutionGroupStatus
>

/** One fresh, explicitly isolated provider environment for one planned requirement. */
export const VerificationExecutionGroup = Schema.Struct({
  id: VerificationExecutionGroupId,
  workflowRunId: WorkflowRunId,
  verificationPlanId: VerificationPlanId,
  requirementId: VerificationRequirementId,
  candidatePatchSetId: CandidatePatchSetId,
  stableKey: Schema.NonEmptyString,
  provider: Schema.NonEmptyString,
  platform: VerificationPlatform,
  architecture: Schema.NonEmptyString,
  commandDigest: Schema.optional(Sha256Digest),
  timeoutSeconds: Schema.optional(NonNegativeInt),
  sharedState: Schema.Literal(false),
  status: VerificationExecutionGroupStatus,
  sandboxId: Schema.optional(Schema.NonEmptyString),
  providerSessionId: Schema.optional(ProviderProcessId),
  providerCommandId: Schema.optional(ProviderProcessId),
  sandboxExecutionId: Schema.optional(SandboxExecutionId),
  claimedAt: EpochMillis,
  startedAt: Schema.optional(EpochMillis),
  completedAt: Schema.optional(EpochMillis),
})
export type VerificationExecutionGroup = Schema.Schema.Type<
  typeof VerificationExecutionGroup
>

export const VerificationLogCaptureStatus = Schema.Literals([
  'captured',
  'truncated',
  'failed',
])
export type VerificationLogCaptureStatus = Schema.Schema.Type<
  typeof VerificationLogCaptureStatus
>

export const SandboxCleanupStatus = Schema.Literals([
  'deleted',
  'failed',
  'retained',
  'not-started',
])
export type SandboxCleanupStatus = Schema.Schema.Type<
  typeof SandboxCleanupStatus
>

export const VerificationResult = Schema.Struct({
  id: VerificationResultId,
  workflowRunId: WorkflowRunId,
  verificationPlanId: Schema.optional(VerificationPlanId),
  executionGroupId: Schema.optional(VerificationExecutionGroupId),
  requirementId: VerificationRequirementId,
  candidatePatchSetId: CandidatePatchSetId,
  sandboxExecutionId: Schema.optional(SandboxExecutionId),
  provider: Schema.NonEmptyString,
  command: Schema.optional(Schema.String),
  commandDigest: Schema.optional(Sha256Digest),
  platform: VerificationPlatform,
  architecture: Schema.NonEmptyString,
  environmentImage: Schema.optional(Schema.NonEmptyString),
  providerSessionId: Schema.optional(ProviderProcessId),
  providerCommandId: Schema.optional(ProviderProcessId),
  status: VerificationResultStatus,
  exitCode: Schema.optional(Schema.Int),
  summary: Schema.optional(Schema.String),
  passedCount: Schema.optional(NonNegativeInt),
  failedCount: Schema.optional(NonNegativeInt),
  skippedCount: Schema.optional(NonNegativeInt),
  artifactIds: Schema.Array(EvidenceArtifactId),
  producedArtifactKinds: Schema.Array(EvidenceArtifactKind),
  stdoutArtifactId: Schema.optional(EvidenceArtifactId),
  stderrArtifactId: Schema.optional(EvidenceArtifactId),
  stdoutCaptureStatus: Schema.optional(VerificationLogCaptureStatus),
  stderrCaptureStatus: Schema.optional(VerificationLogCaptureStatus),
  cleanupStatus: Schema.optional(SandboxCleanupStatus),
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
export type VerificationCoverageStatus = Schema.Schema.Type<
  typeof VerificationCoverageStatus
>

export const decodeVerificationPlanV1 =
  Schema.decodeUnknownEffect(VerificationPlanV1)
export const decodeVerificationRequirement = Schema.decodeUnknownEffect(
  VerificationRequirement,
)
export const decodeVerificationExecutionGroup = Schema.decodeUnknownEffect(
  VerificationExecutionGroup,
)
export const decodeVerificationResult =
  Schema.decodeUnknownEffect(VerificationResult)
export const decodeVerificationRequirements = Schema.decodeUnknownEffect(
  Schema.Array(VerificationRequirement),
)
export const decodeVerificationResults = Schema.decodeUnknownEffect(
  Schema.Array(VerificationResult),
)
