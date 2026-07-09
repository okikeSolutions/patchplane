import { Context, Effect } from 'effect'
import type { ArtifactsError } from '@patchplane/domain/errors'
import type { TelemetryContextFields } from './telemetry-service'

export type EvidenceArtifactKind =
  | 'raw-trace'
  | 'stdout'
  | 'stderr'
  | 'diff'
  | 'test-report'
  | 'screenshot'
  | 'video'
  | 'policy-result'
  | 'trust-report'

export type ArtifactBody = string | Uint8Array | AsyncIterable<Uint8Array>

/** Provider-level metadata for raw artifact bytes. Product artifact identity lives in StorageService/Convex. */
export interface StoredArtifactObjectMetadata {
  readonly storageProvider: 'cloudflare-r2'
  readonly storageKey: string
  readonly contentType: string
  readonly sizeBytes: number
  readonly sha256: string
  readonly createdAt: number
}

export interface PutArtifactInput extends TelemetryContextFields {
  readonly workflowRunId: string
  readonly traceId?: string | undefined
  readonly kind: EvidenceArtifactKind
  readonly contentType: string
  readonly body: ArtifactBody
  readonly storageKeyHint?: string | undefined
  readonly retentionPolicy?: string | undefined
  readonly metadata?: Readonly<Record<string, string>> | undefined
}

export interface GetArtifactMetadataInput extends TelemetryContextFields {
  readonly storageKey: string
}

export interface CreateSignedReadUrlInput extends TelemetryContextFields {
  readonly storageKey: string
  readonly expiresInSeconds: number
}

export interface SignedArtifactReadUrl {
  readonly url: string
  readonly expiresAt: number
}

export interface DeleteArtifactInput extends TelemetryContextFields {
  readonly storageKey: string
}

export interface ApplyArtifactRetentionPolicyInput extends TelemetryContextFields {
  readonly storageKey: string
  /** PatchPlane retention intent/metadata. Provider lifecycle rules may be bucket or prefix scoped. */
  readonly retentionPolicy: string
}

/** Evidence artifact storage boundary. Raw artifact bytes belong outside Convex/provenance stores. */
export class ArtifactsService extends Context.Service<ArtifactsService, {
  readonly putArtifact: (
    input: PutArtifactInput,
  ) => Effect.Effect<StoredArtifactObjectMetadata, ArtifactsError>
  readonly getArtifactMetadata: (
    input: GetArtifactMetadataInput,
  ) => Effect.Effect<StoredArtifactObjectMetadata, ArtifactsError>
  readonly createSignedReadUrl: (
    input: CreateSignedReadUrlInput,
  ) => Effect.Effect<SignedArtifactReadUrl, ArtifactsError>
  readonly deleteArtifact: (
    input: DeleteArtifactInput,
  ) => Effect.Effect<void, ArtifactsError>
  /** Applies PatchPlane retention intent for an artifact. R2 lifecycle enforcement is configured by bucket/prefix. */
  readonly applyRetentionPolicy: (
    input: ApplyArtifactRetentionPolicyInput,
  ) => Effect.Effect<StoredArtifactObjectMetadata, ArtifactsError>
}>()('@patchplane/core/services/ArtifactsService') {}
