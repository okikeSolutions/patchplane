import { Effect, Layer } from 'effect'
import * as Digest from 'effect/crypto/Digest'
import { ArtifactStore } from '@patchplane/core'
import {
  ArtifactIntegrityError,
  type ArtifactRecord,
  ArtifactStorageError,
  sanitizeErrorMessage,
} from '@patchplane/domain'

export interface R2ArtifactObjectPort<E = unknown> {
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

      return ArtifactStore.of({
        putVerifiedArtifact: Effect.fn('R2ArtifactStore.putVerifiedArtifact')(
          function* ({
            attemptId,
            artifactKey,
            body,
            contentType,
            expectedSha256,
          }) {
            const inputSha256 = yield* digest.digestHex(Digest.sha256, body)
            if (inputSha256 !== expectedSha256) {
              return yield* new ArtifactIntegrityError({
                artifactKey,
                expectedSha256,
                actualSha256: inputSha256,
              })
            }

            yield* bucket
              .put(artifactKey, body, {
                httpMetadata: { contentType },
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
                      cause,
                    }),
                ),
              )

            // Confirm integrity by reading back and hashing the persisted bytes.
            const stored = yield* bucket.get(artifactKey).pipe(
              Effect.mapError(
                (cause) =>
                  new ArtifactStorageError({
                    operation: 'R2ArtifactStore.readback',
                    artifactKey,
                    message: sanitizeErrorMessage(cause),
                    cause,
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

            const persistedBytes = yield* stored.bytes().pipe(
              Effect.mapError(
                (cause) =>
                  new ArtifactStorageError({
                    operation: 'R2ArtifactStore.readbackBytes',
                    artifactKey,
                    message: sanitizeErrorMessage(cause),
                    cause,
                  }),
              ),
            )

            const actualSha256 = yield* digest.digestHex(
              Digest.sha256,
              persistedBytes,
            )
            if (actualSha256 !== expectedSha256) {
              return yield* new ArtifactIntegrityError({
                artifactKey,
                expectedSha256,
                actualSha256,
              })
            }

            return {
              artifactKey,
              attemptId,
              sha256: expectedSha256,
              byteLength: persistedBytes.byteLength,
              contentType,
            } satisfies ArtifactRecord
          },
        ),

        getVerifiedArtifact: Effect.fn('R2ArtifactStore.getVerifiedArtifact')(
          function* ({ artifactKey, expectedSha256 }) {
            const stored = yield* bucket.get(artifactKey).pipe(
              Effect.mapError(
                (cause) =>
                  new ArtifactStorageError({
                    operation: 'R2ArtifactStore.get',
                    artifactKey,
                    message: sanitizeErrorMessage(cause),
                    cause,
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

            const bytes = yield* stored.bytes().pipe(
              Effect.mapError(
                (cause) =>
                  new ArtifactStorageError({
                    operation: 'R2ArtifactStore.getBytes',
                    artifactKey,
                    message: sanitizeErrorMessage(cause),
                    cause,
                  }),
              ),
            )

            const actualSha256 = yield* digest.digestHex(Digest.sha256, bytes)
            if (actualSha256 !== expectedSha256) {
              return yield* new ArtifactIntegrityError({
                artifactKey,
                expectedSha256,
                actualSha256,
              })
            }

            return bytes
          },
        ),
      })
    }),
  )
