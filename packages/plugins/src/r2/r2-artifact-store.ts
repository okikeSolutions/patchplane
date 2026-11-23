import { Effect, Layer, Schema } from 'effect'
import * as Digest from 'effect/crypto/Digest'
import {
  ArtifactStore,
  MAX_ANDROID_APK_BYTES,
  MAX_ARTIFACT_BYTES,
} from '@patchplane/core'
import {
  ArtifactIntegrityError,
  type ArtifactRecord,
  ArtifactStorageError,
  SafeContentType,
  sanitizeErrorMessage,
} from '@patchplane/domain'

const STAGE1_APK_KEY_PATTERN = /^attempts\/[^/]+\/android\/app-debug\.apk$/

const maxArtifactBytesForKey = (artifactKey: string): number =>
  STAGE1_APK_KEY_PATTERN.test(artifactKey)
    ? MAX_ANDROID_APK_BYTES
    : MAX_ARTIFACT_BYTES

export interface R2ArtifactObjectPort<E = unknown> {
  readonly size?: number | undefined
  // oxlint-disable-next-line effecttsgo/lazy-effect -- Matches Cloudflare.R2.ObjectBody.bytes() method signature
  readonly bytes: () => Effect.Effect<Uint8Array, E>
}

export interface R2ArtifactBucketPort<
  EPut = unknown,
  EGet = unknown,
  EBody = unknown,
> {
  readonly put: (
    key: string,
    value: Uint8Array,
    options?: {
      readonly httpMetadata?: { readonly contentType?: string }
      readonly customMetadata?: Record<string, string>
    },
  ) => Effect.Effect<unknown, EPut>

  readonly get: (
    key: string,
  ) => Effect.Effect<R2ArtifactObjectPort<EBody> | null, EGet>
}

export const makeR2ArtifactStoreLayer = <EPut, EGet, EBody>(
  bucket: R2ArtifactBucketPort<EPut, EGet, EBody>,
) =>
  Layer.effect(
    ArtifactStore,
    Effect.gen(function* () {
      const digest = yield* Digest.Digest

      const getVerifiedArtifact = Effect.fn(
        'R2ArtifactStore.getVerifiedArtifact',
      )(function* ({
        artifactKey,
        expectedSha256,
      }: Parameters<(typeof ArtifactStore.Service)['getVerifiedArtifact']>[0]) {
        const stored = yield* bucket.get(artifactKey).pipe(
          Effect.mapError(
            (cause) =>
              new ArtifactStorageError({
                operation: 'R2ArtifactStore.get',
                artifactKey,
                message: sanitizeErrorMessage(cause),
              }),
          ),
        )

        if (stored === null) {
          return yield* new ArtifactIntegrityError({
            artifactKey,
            expectedSha256,
            actualSha256: '<missing>',
          })
        }

        const maxBytes = maxArtifactBytesForKey(artifactKey)
        if (stored.size !== undefined && stored.size > maxBytes) {
          return yield* new ArtifactStorageError({
            operation: 'R2ArtifactStore.get',
            artifactKey,
            message: `Artifact size (${stored.size} bytes) exceeds limit (${maxBytes} bytes)`,
          })
        }

        const bytes = yield* stored.bytes().pipe(
          Effect.mapError(
            (cause) =>
              new ArtifactStorageError({
                operation: 'R2ArtifactStore.getBytes',
                artifactKey,
                message: sanitizeErrorMessage(cause),
              }),
          ),
        )

        if (bytes.byteLength > maxBytes) {
          return yield* new ArtifactStorageError({
            operation: 'R2ArtifactStore.getBytes',
            artifactKey,
            message: `Artifact size (${bytes.byteLength} bytes) exceeds limit (${maxBytes} bytes)`,
          })
        }

        const actualSha256 = yield* digest.digestHex(Digest.sha256, bytes)
        if (actualSha256 !== expectedSha256) {
          return yield* new ArtifactIntegrityError({
            artifactKey,
            expectedSha256,
            actualSha256,
          })
        }

        return bytes
      })

      return ArtifactStore.of({
        putVerifiedArtifact: Effect.fn('R2ArtifactStore.putVerifiedArtifact')(
          function* ({
            attemptId,
            artifactKey,
            body,
            contentType,
            expectedSha256,
          }) {
            const safeContentType = yield* Schema.decodeEffect(SafeContentType)(
              contentType,
            ).pipe(
              Effect.mapError(
                (cause) =>
                  new ArtifactStorageError({
                    operation: 'R2ArtifactStore.validateContentType',
                    artifactKey,
                    message: sanitizeErrorMessage(cause),
                  }),
              ),
            )

            const maxBytes = maxArtifactBytesForKey(artifactKey)
            if (body.byteLength > maxBytes) {
              return yield* new ArtifactStorageError({
                operation: 'R2ArtifactStore.put',
                artifactKey,
                message: `Artifact size (${body.byteLength} bytes) exceeds limit (${maxBytes} bytes)`,
              })
            }

            const inputSha256 = yield* digest.digestHex(Digest.sha256, body)
            if (inputSha256 !== expectedSha256) {
              return yield* new ArtifactIntegrityError({
                artifactKey,
                expectedSha256,
                actualSha256: inputSha256,
              })
            }

            // Refuse to overwrite an existing R2 artifact with conflicting bytes
            // so retries cannot diverge R2 from committed Postgres provenance.
            const existing = yield* bucket.get(artifactKey).pipe(
              Effect.mapError(
                (cause) =>
                  new ArtifactStorageError({
                    operation: 'R2ArtifactStore.checkExisting',
                    artifactKey,
                    message: sanitizeErrorMessage(cause),
                  }),
              ),
            )
            if (existing !== null) {
              const existingBytes = yield* existing.bytes().pipe(
                Effect.mapError(
                  (cause) =>
                    new ArtifactStorageError({
                      operation: 'R2ArtifactStore.checkExistingBytes',
                      artifactKey,
                      message: sanitizeErrorMessage(cause),
                    }),
                ),
              )
              const existingSha = yield* digest.digestHex(
                Digest.sha256,
                existingBytes,
              )
              if (existingSha !== expectedSha256) {
                return yield* new ArtifactIntegrityError({
                  artifactKey,
                  expectedSha256,
                  actualSha256: existingSha,
                })
              }
              return {
                artifactKey,
                attemptId,
                sha256: expectedSha256,
                byteLength: existingBytes.byteLength,
                contentType: safeContentType,
              } satisfies ArtifactRecord
            }

            yield* bucket
              .put(artifactKey, body, {
                httpMetadata: { contentType: safeContentType },
                customMetadata: {
                  'patchplane-attempt-id': attemptId,
                  'patchplane-sha256': expectedSha256,
                },
              })
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new ArtifactStorageError({
                      operation: 'R2ArtifactStore.put',
                      artifactKey,
                      message: sanitizeErrorMessage(cause),
                    }),
                ),
              )

            // Confirm integrity by reading back and hashing the persisted bytes.
            const persistedBytes = yield* getVerifiedArtifact({
              artifactKey,
              expectedSha256,
            })

            return {
              artifactKey,
              attemptId,
              sha256: expectedSha256,
              byteLength: persistedBytes.byteLength,
              contentType: safeContentType,
            } satisfies ArtifactRecord
          },
        ),

        getVerifiedArtifact,
      })
    }),
  )
