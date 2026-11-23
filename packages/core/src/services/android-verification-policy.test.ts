import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import * as Redacted from 'effect/Redacted'
import { CloudDeviceProviderId, Sha256Hex } from '@patchplane/domain'
import {
  assertCloudOnlyProvider,
  assertDedicatedDevAccountAndSyntheticFixture,
  assertSafeApkOutputPath,
  assertValidArbeoObservation,
  EXPECTED_ARBEO_IMPORT_DURATION,
} from './android-verification-policy'

describe('Cloud Android verification security & Arbeo journey policy', () => {
  it.effect(
    'rejects personal-device, local, Mac, and SimLock providers while allowing isolated cloud providers',
    () =>
      Effect.gen(function* () {
        for (const badProvider of [
          'local-simlock',
          'developer-mac',
          'macbook-emulator',
          'personal-android',
          'localhost-adb',
          'xcrun-simctl',
        ]) {
          const failure = yield* Effect.flip(
            assertCloudOnlyProvider({
              providerId: CloudDeviceProviderId.make(badProvider),
              executionEnvironment: 'cloud-isolated',
            }),
          )
          expect(failure._tag).toBe('CloudDevicePolicyError')
        }

        const nonCloud = yield* Effect.flip(
          assertCloudOnlyProvider({
            providerId: CloudDeviceProviderId.make('github-actions-kvm'),
            executionEnvironment: 'developer-laptop',
          }),
        )
        expect(nonCloud._tag).toBe('CloudDevicePolicyError')

        for (const validCloud of [
          'github-actions-kvm',
          'expo-simulators',
          'cloud-kvm-worker-pool',
        ]) {
          const accepted = yield* assertCloudOnlyProvider({
            providerId: CloudDeviceProviderId.make(validCloud),
            executionEnvironment: 'cloud-isolated',
          })
          expect(accepted).toBe(validCloud)
        }
      }),
  )

  it.effect(
    'rejects production/personal/signing accounts, SSRF APK URLs, and unsafe APK output paths',
    () =>
      Effect.gen(function* () {
        const validUrl = Redacted.make(
          'https://artifacts.patchplane.dev/attempts/a1/app-debug.apk?sig=abc',
        )

        for (const badAccount of [
          '',
          'prod-admin@arbeo.app',
          'personal-user@gmail.com',
          'play-store-release',
          'android-keystore-signer',
        ]) {
          const failure = yield* Effect.flip(
            assertDedicatedDevAccountAndSyntheticFixture({
              devAccountHandle: badAccount,
              syntheticFixtureId: 'arbeo-synthetic-5h-v1',
              apkDownloadUrl: validUrl,
            }),
          )
          expect(failure._tag).toBe('CloudDevicePolicyError')
        }

        for (const badUrl of [
          'http://artifacts.patchplane.dev/app-debug.apk',
          'https://user:pass@artifacts.patchplane.dev/app-debug.apk',
          'https://127.0.0.1/app-debug.apk',
          'https://169.254.169.254/latest/meta-data',
          'https://storage.internal/app-debug.apk',
          'https://artifacts.patchplane.dev/app-debug.apk#fragment',
        ]) {
          const failure = yield* Effect.flip(
            assertDedicatedDevAccountAndSyntheticFixture({
              devAccountHandle: 'dev-qa-bot@arbeo.test',
              syntheticFixtureId: 'arbeo-synthetic-5h-v1',
              apkDownloadUrl: Redacted.make(badUrl),
            }),
          )
          expect(failure._tag).toBe('CloudDevicePolicyError')
        }

        for (const badPath of [
          '../escape/app-debug.apk',
          'app/build/outputs/apk/debug/not-an-apk.txt',
          'app/build/$(whoami).apk',
          '',
        ]) {
          const failure = yield* Effect.flip(assertSafeApkOutputPath(badPath))
          expect(failure._tag).toBe('CloudDevicePolicyError')
        }
      }),
  )

  it.effect(
    'enforces exact APK SHA-256, +05:00 preview & confirmation, offline restart persistence, KVM, and cleanup',
    () =>
      Effect.gen(function* () {
        const expectedSha = Sha256Hex.make('a'.repeat(64))
        const mismatchedSha = Sha256Hex.make('b'.repeat(64))

        const tampered = yield* Effect.flip(
          assertValidArbeoObservation({
            expectedApkSha256: expectedSha,
            observation: {
              observedApkSha256: mismatchedSha,
              apkSha256Verified: true,
              cleanEmulatorBooted: true,
              kvmAccelerated: true,
              importPreviewDuration: EXPECTED_ARBEO_IMPORT_DURATION,
              importConfirmedDuration: EXPECTED_ARBEO_IMPORT_DURATION,
              persistedAfterOfflineRestart: true,
              cleanupConfirmed: true,
            },
          }),
        )
        expect(tampered._tag).toBe('ApkIntegrityError')

        const failedOffline = yield* assertValidArbeoObservation({
          expectedApkSha256: expectedSha,
          observation: {
            observedApkSha256: expectedSha,
            apkSha256Verified: true,
            cleanEmulatorBooted: true,
            kvmAccelerated: true,
            importPreviewDuration: '+04:30',
            importConfirmedDuration: EXPECTED_ARBEO_IMPORT_DURATION,
            persistedAfterOfflineRestart: false,
            cleanupConfirmed: true,
          },
        })
        expect(failedOffline.passed).toBe(false)
        expect(failedOffline.failures).toHaveLength(2)

        const passed = yield* assertValidArbeoObservation({
          expectedApkSha256: expectedSha,
          observation: {
            observedApkSha256: expectedSha,
            apkSha256Verified: true,
            cleanEmulatorBooted: true,
            kvmAccelerated: true,
            importPreviewDuration: EXPECTED_ARBEO_IMPORT_DURATION,
            importConfirmedDuration: EXPECTED_ARBEO_IMPORT_DURATION,
            persistedAfterOfflineRestart: true,
            cleanupConfirmed: true,
          },
        })
        expect(passed.passed).toBe(true)
        expect(passed.failures).toEqual([])
      }),
  )
})
