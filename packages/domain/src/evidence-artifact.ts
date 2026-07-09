import { Schema } from 'effect'
import { WorkflowRunId } from './ids'

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
  id: Schema.String,
  workflowRunId: WorkflowRunId,
  traceId: Schema.optional(Schema.String),
  kind: EvidenceArtifactKind,
  label: Schema.optional(Schema.String),
  storageProvider: EvidenceArtifactStorageProvider,
  storageKey: Schema.String,
  contentType: Schema.String,
  sizeBytes: Schema.Number,
  sha256: Schema.String,
  retentionPolicy: Schema.optional(Schema.String),
  createdAt: Schema.Number,
})
export type EvidenceArtifact = Schema.Schema.Type<typeof EvidenceArtifact>

export const decodeEvidenceArtifact = Schema.decodeUnknownEffect(EvidenceArtifact)
export const decodeEvidenceArtifacts = Schema.decodeUnknownEffect(Schema.Array(EvidenceArtifact))
