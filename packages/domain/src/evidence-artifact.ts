import { Schema } from 'effect'
import { CandidatePatchSetId, EvidenceArtifactId, VerificationResultId, WorkflowRunId } from './ids'
import { EpochMillis, NonNegativeInt, Sha256Digest, Sha256Hex } from './refinements'

/**
 * Raw evidence bytes live in an artifact store such as Cloudflare R2.
 *
 * Convex and Patch Report records keep this metadata only: enough to verify,
 * authorize, locate, and render links to the artifact without treating large
 * untrusted output as product truth inside the read model.
 */
export const EvidenceArtifactKind = Schema.Literals([
  'raw-trace',
  'stdout',
  'stderr',
  'diff',
  'test-report',
  'screenshot',
  'video',
  'policy-result',
  'trust-report',
])
export type EvidenceArtifactKind = Schema.Schema.Type<typeof EvidenceArtifactKind>

export const EvidenceArtifactStorageProvider = Schema.Literals([
  'cloudflare-r2',
])
export type EvidenceArtifactStorageProvider = Schema.Schema.Type<
  typeof EvidenceArtifactStorageProvider
>

export const EvidenceArtifact = Schema.Struct({
  id: EvidenceArtifactId,
  workflowRunId: WorkflowRunId,
  candidatePatchSetId: Schema.optional(CandidatePatchSetId),
  verificationResultId: Schema.optional(VerificationResultId),
  producer: Schema.optional(Schema.NonEmptyString),
  subjectDigest: Schema.optional(Sha256Digest),
  traceId: Schema.optional(Schema.NonEmptyString),
  kind: EvidenceArtifactKind,
  label: Schema.optional(Schema.String),
  storageProvider: EvidenceArtifactStorageProvider,
  storageKey: Schema.NonEmptyString,
  contentType: Schema.NonEmptyString,
  sizeBytes: NonNegativeInt,
  sha256: Sha256Hex,
  retentionPolicy: Schema.optional(Schema.NonEmptyString),
  createdAt: EpochMillis,
})
export type EvidenceArtifact = Schema.Schema.Type<typeof EvidenceArtifact>

export const decodeEvidenceArtifact = Schema.decodeUnknownEffect(EvidenceArtifact)
export const decodeEvidenceArtifacts = Schema.decodeUnknownEffect(Schema.Array(EvidenceArtifact))
