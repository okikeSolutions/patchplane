import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import * as Redacted from 'effect/Redacted'
import {
  CloudDeviceProviderId,
  sanitizeErrorMessage,
  Sha256Hex,
} from '@patchplane/domain'
import {
  assertAllowedStage2ContentType,
  assertCloudOnlyProvider,
  assertDedicatedDevAccountAndSyntheticFixture,
  assertSafeApkOutputPath,
  assertSafeRedactedHttpsUrl,
  assertValidArbeoObservation,
  EXPECTED_ARBEO_IMPORT_DURATION,
} from './android-verification-policy'

describe('Cloud Android verification security & Arbeo journey policy', () => {
  it.effect(
    'rejects personal-device, local, Mac, and bare/local SimLock providers while allowing isolated cloud providers and cloud SimLock pools',
    () =>
      Effect.gen(function* () {
        for (const badProvider of [
          'simlock',
          'local-simlock',
          'personal-simlock',
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
          'cloud-kvm-simlock-pool',
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
    'rejects production/personal/signing accounts, flag injection, SSRF APK URLs, unsafe APK paths, and disallowed MIME types',
    () =>
      Effect.gen(function* () {
        const validUrl = Redacted.make(
          'https://artifacts.patchplane.dev/attempts/a1/app-debug.apk?X-Amz-Signature=abc123',
        )

        for (const badAccount of [
          '',
          '-D',
          '--user',
          'prod-admin@arbeo.app',
          'qa-prod@arbeo.app',
          'qa-production@arbeo.app',
          'alice@gmail.com',
          'personal-user@arbeo.test',
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

        const badFixture = yield* Effect.flip(
          assertDedicatedDevAccountAndSyntheticFixture({
            devAccountHandle: 'dev-qa-bot@arbeo.test',
            syntheticFixtureId: '-e',
            apkDownloadUrl: validUrl,
          }),
        )
        expect(badFixture._tag).toBe('CloudDevicePolicyError')

        for (const badUrl of [
          'http://artifacts.patchplane.dev/app-debug.apk',
          'https://user:pass@artifacts.patchplane.dev/app-debug.apk',
          'https://127.0.0.1/app-debug.apk',
          'https://0.0.0.1/app-debug.apk',
          'https://100.64.0.1/app-debug.apk',
          'https://169.254.169.254/latest/meta-data',
          'https://[::1]/app-debug.apk',
          'https://[::]/app-debug.apk',
          'https://[::ffff:127.0.0.1]/app-debug.apk',
          'https://[::ffff:169.254.169.254]/latest/meta-data',
          'https://[fc01::1]/app-debug.apk',
          'https://[fe90::1]/app-debug.apk',
          'https://localhost./app-debug.apk',
          'https://storage.internal./app-debug.apk',
          'https://artifacts.patchplane.dev:8443/app-debug.apk',
          'https://artifacts.patchplane.dev/app-debug.apk#fragment',
        ]) {
          const failure = yield* Effect.flip(
            assertSafeRedactedHttpsUrl({
              field: 'apkDownloadUrl',
              url: Redacted.make(badUrl),
              allowQueryString: true,
            }),
          )
          expect(failure._tag).toBe('CloudDevicePolicyError')
        }

        // Valid standard-port HTTPS URL succeeds and returns void (no unwrapped leak)
        const ok = yield* assertSafeRedactedHttpsUrl({
          field: 'apkDownloadUrl',
          url: validUrl,
          allowQueryString: true,
        })
        expect(ok).toBeUndefined()

        for (const badPath of [
          '/app/build/outputs/apk/debug/app-debug.apk',
          'app//debug/app-debug.apk',
          '-flag/app-debug.apk',
          '../escape/app-debug.apk',
          'app/build/outputs/apk/debug/not-an-apk.txt',
          'app/build/$(whoami).apk',
          '',
        ]) {
          const failure = yield* Effect.flip(assertSafeApkOutputPath(badPath))
          expect(failure._tag).toBe('CloudDevicePolicyError')
        }

        for (const badMime of [
          'text/html',
          'image/svg+xml',
          'image/png\r\nX-Injected: 1',
        ]) {
          const failure = yield* Effect.flip(
            assertAllowedStage2ContentType(badMime),
          )
          expect(failure._tag).toBe('CloudDevicePolicyError')
        }
        expect(yield* assertAllowedStage2ContentType('image/png')).toBe(
          'image/png',
        )

        const scrubbed = sanitizeErrorMessage(
          'curl failed for https://r2.patchplane.dev/app.apk?X-Amz-Signature=deadbeef&X-Amz-Credential=akid&sig=topsecret',
        )
        expect(scrubbed).not.toContain('deadbeef')
        expect(scrubbed).not.toContain('akid')
        expect(scrubbed).not.toContain('topsecret')
      }),
  )

  it.effect(
    'enforces exact APK SHA-256, +05:00 preview & confirmation, offline restart persistence, and cleanup in a provider-neutral way',
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
            importPreviewDuration: '+04:30',
            importConfirmedDuration: EXPECTED_ARBEO_IMPORT_DURATION,
            persistedAfterOfflineRestart: false,
            cleanupConfirmed: true,
          },
        })
        expect(failedOffline.passed).toBe(false)
        expect(failedOffline.failures).toHaveLength(2)

        // Core policy passes without requiring Linux-only kvmAccelerated
        const passed = yield* assertValidArbeoObservation({
          expectedApkSha256: expectedSha,
          observation: {
            observedApkSha256: expectedSha,
            apkSha256Verified: true,
            cleanEmulatorBooted: true,
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
