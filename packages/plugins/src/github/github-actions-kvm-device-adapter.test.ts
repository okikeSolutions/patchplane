import { describe, expect, it } from '@effect/vitest'
import { Duration, Effect, Fiber, Layer } from 'effect'
import * as Digest from 'effect/crypto/Digest'
import * as Redacted from 'effect/Redacted'
import * as TestClock from 'effect/testing/TestClock'
import {
  ArtifactStore,
  CloudAndroidDeviceAdapter,
  EXPECTED_ARBEO_IMPORT_DURATION,
  SandboxProvider,
} from '@patchplane/core'
import {
  AndroidPackageName,
  ArtifactKey,
  ChangeRequestId,
  CloudDeviceRunId,
  GitCommitSha,
  SandboxId,
  Sha256Hex,
  VerificationAttemptId,
} from '@patchplane/domain'
import { makeDaytonaSandboxProviderLayer } from '../daytona/daytona-sandbox-provider'
import { makeR2ArtifactStoreLayer } from '../r2/r2-artifact-store'
import { makeGitHubActionsKvmDeviceAdapterLayer } from './github-actions-kvm-device-adapter'

const EXPECTED_SHA = Sha256Hex.make('a'.repeat(64))
const RUN_ID = CloudDeviceRunId.make('gha-unit-1')

describe('Cloud Android plugin adapters security & boundary checks', () => {
  it.effect(
    'GitHubActionsKvmDeviceAdapter enforces kvmAccelerated=true, validates raw.artifacts at the boundary, and enforces timeout',
    () =>
      Effect.gen(function* () {
        // 1) Rejects kvmAccelerated !== true
        const noKvmLayer = makeGitHubActionsKvmDeviceAdapterLayer({
          dispatchWorkflow: () => Effect.succeed({ runId: RUN_ID }),
          awaitWorkflowResult: () =>
            Effect.succeed({
              runId: RUN_ID,
              observation: {
                observedApkSha256: EXPECTED_SHA,
                apkSha256Verified: true,
                cleanEmulatorBooted: true,
                kvmAccelerated: false,
                importPreviewDuration: EXPECTED_ARBEO_IMPORT_DURATION,
                importConfirmedDuration: EXPECTED_ARBEO_IMPORT_DURATION,
                persistedAfterOfflineRestart: true,
                cleanupConfirmed: true,
              },
              artifacts: [],
            }),
        })

        const noKvmErr = yield* Effect.flip(
          Effect.gen(function* () {
            const adapter = yield* CloudAndroidDeviceAdapter
            return yield* adapter.awaitVerificationResult({
              runId: RUN_ID,
              expectedApkSha256: EXPECTED_SHA,
              timeoutMs: 5_000,
            })
          }).pipe(Effect.provide(noKvmLayer)),
        )
        expect(noKvmErr._tag).toBe('CloudDeviceExecutionError')
        expect(noKvmErr.message).toContain('/dev/kvm')

        // 2) Rejects untrusted raw.artifacts with CR/LF contentType or non-Uint8Array bytes
        const badArtifactLayer = makeGitHubActionsKvmDeviceAdapterLayer({
          dispatchWorkflow: () => Effect.succeed({ runId: RUN_ID }),
          awaitWorkflowResult: () =>
            Effect.succeed({
              runId: RUN_ID,
              observation: {
                observedApkSha256: EXPECTED_SHA,
                apkSha256Verified: true,
                cleanEmulatorBooted: true,
                kvmAccelerated: true,
                importPreviewDuration: EXPECTED_ARBEO_IMPORT_DURATION,
                importConfirmedDuration: EXPECTED_ARBEO_IMPORT_DURATION,
                persistedAfterOfflineRestart: true,
                cleanupConfirmed: true,
              },
              artifacts: [
                {
                  relativePath: 'shot.png',
                  contentType: 'image/png\r\nX-Bad: 1',
                  bytes: new Uint8Array([1, 2, 3]),
                },
              ],
            }),
        })

        const badArtifactErr = yield* Effect.flip(
          Effect.gen(function* () {
            const adapter = yield* CloudAndroidDeviceAdapter
            return yield* adapter.awaitVerificationResult({
              runId: RUN_ID,
              expectedApkSha256: EXPECTED_SHA,
              timeoutMs: 5_000,
            })
          }).pipe(Effect.provide(badArtifactLayer)),
        )
        expect(badArtifactErr._tag).toBe('CloudDeviceExecutionError')

        // 3) Enforces Effect-level TestClock timeout on awaitWorkflowResult
        const hangingLayer = makeGitHubActionsKvmDeviceAdapterLayer({
          dispatchWorkflow: () => Effect.succeed({ runId: RUN_ID }),
          awaitWorkflowResult: () => Effect.never,
        })
        const fiber = yield* Effect.forkChild(
          Effect.flip(
            Effect.gen(function* () {
              const adapter = yield* CloudAndroidDeviceAdapter
              return yield* adapter.awaitVerificationResult({
                runId: RUN_ID,
                expectedApkSha256: EXPECTED_SHA,
                timeoutMs: 2_000,
              })
            }).pipe(Effect.provide(hangingLayer)),
          ),
        )
        yield* TestClock.adjust(Duration.millis(2_001))
        const timeoutErr = yield* Fiber.join(fiber)
        expect(timeoutErr._tag).toBe('CloudDeviceExecutionError')
      }),
  )

  it.effect(
    'DaytonaSandboxProvider stats files BEFORE reading bytes to prevent OOM and symlink/directory reads',
    () =>
      Effect.gen(function* () {
        let readFileCalls = 0
        const sbxId = SandboxId.make('sbx-stat-guard')
        const providerLayer = makeDaytonaSandboxProviderLayer({
          create: () => Effect.fail('unused'),
          get: () =>
            Effect.succeed({
              sandboxId: sbxId,
              state: 'started',
              labels: {},
              exec: () => Effect.succeed({ exitCode: 0, result: '' }),
              statFile: (path) =>
                path.endsWith('huge.apk')
                  ? Effect.succeed({ size: 100 * 1024 * 1024, isDir: false })
                  : Effect.succeed({
                      size: 100,
                      isDir: false,
                      isSymlink: true,
                    }),
              readFile: () =>
                Effect.sync(() => {
                  readFileCalls += 1
                  return new Uint8Array([1, 2, 3])
                }),
            }),
          list: () => Effect.succeed([]),
          delete: () => Effect.void,
        })

        const hugeErr = yield* Effect.flip(
          Effect.gen(function* () {
            const provider = yield* SandboxProvider
            return yield* provider.readFileBytes({
              sandboxId: sbxId,
              path: 'app/huge.apk',
              maxBytes: 1024,
              timeoutMs: 5_000,
            })
          }).pipe(Effect.provide(providerLayer)),
        )
        expect(hugeErr._tag).toBe('SandboxExecutionError')
        expect(readFileCalls).toBe(0)

        const symlinkErr = yield* Effect.flip(
          Effect.gen(function* () {
            const provider = yield* SandboxProvider
            return yield* provider.readFileBytes({
              sandboxId: sbxId,
              path: 'app/link.apk',
              maxBytes: 1024,
              timeoutMs: 5_000,
            })
          }).pipe(Effect.provide(providerLayer)),
        )
        expect(symlinkErr._tag).toBe('SandboxExecutionError')
        expect(readFileCalls).toBe(0)
      }),
  )

  it.effect(
    'R2ArtifactStore scopes 64 MiB strictly to canonical Stage 1 APK keys and refuses overwriting existing objects with a different digest',
    () =>
      Effect.gen(function* () {
        const objects = new Map<string, Uint8Array>()
        const r2Layer = makeR2ArtifactStoreLayer({
          put: (key, value) =>
            Effect.sync(() => {
              objects.set(key, new Uint8Array(value))
            }),
          get: (key) =>
            Effect.sync(() => {
              const found = objects.get(key)
              if (found === undefined) return null
              return {
                size: found.byteLength,
                bytes: () => Effect.succeed(new Uint8Array(found)),
              }
            }),
        }).pipe(Layer.provideMerge(Digest.layerWebCrypto))

        const attemptId = VerificationAttemptId.make('attempt-r2-unit')
        const digest = yield* Digest.Digest.pipe(
          Effect.provide(Digest.layerWebCrypto),
        )
        const bodyA = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1])
        const bodyB = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 2])
        const shaA = Sha256Hex.make(
          yield* digest.digestHex(Digest.sha256, bodyA),
        )
        const shaB = Sha256Hex.make(
          yield* digest.digestHex(Digest.sha256, bodyB),
        )
        const key = ArtifactKey.make(
          `attempts/${attemptId}/android/app-debug.apk`,
        )

        yield* Effect.gen(function* () {
          const store = yield* ArtifactStore
          // First put succeeds
          yield* store.putVerifiedArtifact({
            attemptId,
            artifactKey: key,
            body: bodyA,
            contentType: 'application/vnd.android.package-archive',
            expectedSha256: shaA,
          })
          // Idempotent put with identical SHA-256 succeeds
          yield* store.putVerifiedArtifact({
            attemptId,
            artifactKey: key,
            body: bodyA,
            contentType: 'application/vnd.android.package-archive',
            expectedSha256: shaA,
          })
          // Overwrite with DIFFERENT SHA-256 fails closed!
          const overwriteErr = yield* Effect.flip(
            store.putVerifiedArtifact({
              attemptId,
              artifactKey: key,
              body: bodyB,
              contentType: 'application/vnd.android.package-archive',
              expectedSha256: shaB,
            }),
          )
          expect(overwriteErr._tag).toBe('ArtifactIntegrityError')

          // CRLF contentType fails closed
          const crlfErr = yield* Effect.flip(
            store.putVerifiedArtifact({
              attemptId,
              artifactKey: ArtifactKey.make(
                `attempts/${attemptId}/android/other.txt`,
              ),
              body: bodyA,
              contentType: 'text/plain\r\nX-Injected: bad',
              expectedSha256: shaA,
            }),
          )
          expect(crlfErr._tag).toBe('ArtifactStorageError')

          // Non-canonical .apk key (e.g. arbitrary Stage 2 path) stays at 16 MiB cap, not 64 MiB
          const nonCanonicalApk = new Uint8Array(16 * 1024 * 1024 + 1)
          const nonCanonicalSha = Sha256Hex.make(
            yield* digest.digestHex(Digest.sha256, nonCanonicalApk),
          )
          const nonCanonicalErr = yield* Effect.flip(
            store.putVerifiedArtifact({
              attemptId,
              artifactKey: ArtifactKey.make(
                `attempts/${attemptId}/android/device/run-1/sneaky.apk`,
              ),
              body: nonCanonicalApk,
              contentType: 'application/vnd.android.package-archive',
              expectedSha256: nonCanonicalSha,
            }),
          )
          expect(nonCanonicalErr._tag).toBe('ArtifactStorageError')
        }).pipe(Effect.provide(r2Layer))

        // Silence unused Redacted check — verify GitHub adapter rejects non-HTTPS URL at boundary
        const badDispatchLayer = makeGitHubActionsKvmDeviceAdapterLayer({
          dispatchWorkflow: () => Effect.succeed({ runId: RUN_ID }),
          awaitWorkflowResult: () => Effect.fail('unused'),
        })
        const badUrlErr = yield* Effect.flip(
          Effect.gen(function* () {
            const adapter = yield* CloudAndroidDeviceAdapter
            return yield* adapter.dispatchApkVerification({
              attemptId,
              changeRequestId: ChangeRequestId.make(
                'github:okikeSolutions/arbeo#1',
              ),
              sourceSha: GitCommitSha.make('1'.repeat(40)),
              apkArtifactKey: key,
              expectedApkSha256: shaA,
              apkDownloadUrl: Redacted.make('http://127.0.0.1/app.apk'),
              packageName: AndroidPackageName.make(
                'com.okikesolutions.arbeo.debug',
              ),
              syntheticFixtureId: 'arbeo-synthetic-5h-v1',
              devAccountHandle: 'dev-qa-bot@arbeo.test',
              timeoutMs: 5_000,
            })
          }).pipe(Effect.provide(badDispatchLayer)),
        )
        expect(badUrlErr._tag).toBe('CloudDevicePolicyError')
      }),
  )
})
