import { Effect } from 'effect'
import * as Redacted from 'effect/Redacted'
import {
  ApkIntegrityError,
  type ArbeoJourneyObservation,
  type CloudDeviceProviderId,
  CloudDevicePolicyError,
  type Sha256Hex,
} from '@patchplane/domain'

/** Hard cap on a Stage 1 debug APK read into the control-plane container (64 MiB). */
export const MAX_ANDROID_APK_BYTES = 64 * 1024 * 1024

/** Hard caps on Stage 2 diagnostic artifacts returned from the cloud device runner. */
export const MAX_CLOUD_DEVICE_ARTIFACT_COUNT = 8
export const MAX_CLOUD_DEVICE_ARTIFACT_BYTES = 16 * 1024 * 1024
export const MAX_CLOUD_DEVICE_TOTAL_ARTIFACT_BYTES = 32 * 1024 * 1024

/** Default & maximum Stage 2 cloud emulator verification timeout. */
export const DEFAULT_CLOUD_DEVICE_TIMEOUT_MS = 15 * 60 * 1000
export const MAX_CLOUD_DEVICE_TIMEOUT_MS = 30 * 60 * 1000

/** Expected Arbeo synthetic offline work-time calculation result. */
export const EXPECTED_ARBEO_IMPORT_DURATION = '+05:00'

const FORBIDDEN_PERSONAL_DEVICE_PATTERNS: ReadonlyArray<RegExp> = [
  /simlock/i,
  /\blocal\b/i,
  /localhost/i,
  /127\.0\.0\.1/,
  /personal/i,
  /laptop/i,
  /macbook/i,
  /developer[-_]?mac/i,
  /xcrun/i,
]

const FORBIDDEN_URL_HOST_PATTERNS: ReadonlyArray<RegExp> = [
  /^localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /^127\./,
  /^10\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(?:1[6-9]|2\d|3[01])\./,
  /^0\.0\.0\.0$/,
  /^\[?::1\]?$/,
  /^\[?fe80:/i,
  /^\[?fc00:/i,
  /^\[?fd/i,
]

const FORBIDDEN_PRODUCTION_OR_SIGNING_PATTERNS: ReadonlyArray<RegExp> = [
  /keystore/i,
  /signing/i,
  /release[-_]?key/i,
  /play[-_]?store/i,
  /google[-_]?play/i,
  /^prod(?:uction)?[-_:.@/]/i,
  /[-_:.@/]prod(?:uction)?$/i,
  /personal/i,
]

const SAFE_SANDBOX_FILE_PATH = /^[A-Za-z0-9._/-]+$/

export const assertCloudOnlyProvider = Effect.fn(
  'AndroidVerificationPolicy.assertCloudOnlyProvider',
)(function* (input: {
  readonly providerId: CloudDeviceProviderId
  readonly executionEnvironment: string
}) {
  if (input.executionEnvironment !== 'cloud-isolated') {
    return yield* new CloudDevicePolicyError({
      field: 'executionEnvironment',
      reason:
        'Patchplane never executes untrusted Android verification on personal or non-cloud devices',
    })
  }
  for (const pattern of FORBIDDEN_PERSONAL_DEVICE_PATTERNS) {
    if (pattern.test(input.providerId)) {
      return yield* new CloudDevicePolicyError({
        field: 'providerId',
        reason: `Personal or local device provider "${input.providerId}" is forbidden by security-by-design policy`,
      })
    }
  }
  return input.providerId
})

export const assertSafeRemoteHttpsUrl = Effect.fn(
  'AndroidVerificationPolicy.assertSafeRemoteHttpsUrl',
)(function* (input: {
  readonly field: string
  readonly rawUrl: string
  readonly allowQueryString: boolean
}) {
  const parsed = yield* Effect.try({
    try: () => new URL(input.rawUrl),
    catch: () =>
      new CloudDevicePolicyError({
        field: input.field,
        reason: `${input.field} must be a valid HTTPS URL`,
      }),
  })
  if (parsed.protocol !== 'https:') {
    return yield* new CloudDevicePolicyError({
      field: input.field,
      reason: `${input.field} must use https://`,
    })
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    return yield* new CloudDevicePolicyError({
      field: input.field,
      reason: `${input.field} must not embed credentials`,
    })
  }
  if (parsed.hash.length > 0) {
    return yield* new CloudDevicePolicyError({
      field: input.field,
      reason: `${input.field} must not include a URL fragment`,
    })
  }
  if (!input.allowQueryString && parsed.search.length > 0) {
    return yield* new CloudDevicePolicyError({
      field: input.field,
      reason: `${input.field} must not include query parameters`,
    })
  }
  for (const pattern of FORBIDDEN_URL_HOST_PATTERNS) {
    if (pattern.test(parsed.hostname)) {
      return yield* new CloudDevicePolicyError({
        field: input.field,
        reason: `${input.field} host "${parsed.hostname}" is not permitted`,
      })
    }
  }
  return parsed.toString()
})

export const assertSafeApkOutputPath = Effect.fn(
  'AndroidVerificationPolicy.assertSafeApkOutputPath',
)(function* (apkPath: string) {
  const trimmed = apkPath.trim()
  if (
    trimmed.length === 0 ||
    !SAFE_SANDBOX_FILE_PATH.test(trimmed) ||
    !trimmed.endsWith('.apk') ||
    trimmed.split('/').some((seg) => seg === '..' || seg === '.')
  ) {
    return yield* new CloudDevicePolicyError({
      field: 'apkOutputPath',
      reason: 'APK output path must be a safe .apk path without traversal',
    })
  }
  return trimmed
})

export const assertDedicatedDevAccountAndSyntheticFixture = Effect.fn(
  'AndroidVerificationPolicy.assertDedicatedDevAccountAndSyntheticFixture',
)(function* (input: {
  readonly devAccountHandle: string
  readonly syntheticFixtureId: string
  readonly apkDownloadUrl: Redacted.Redacted
}) {
  const account = input.devAccountHandle.trim()
  if (account.length === 0) {
    return yield* new CloudDevicePolicyError({
      field: 'devAccountHandle',
      reason:
        'A dedicated non-production development account handle is required',
    })
  }
  for (const pattern of FORBIDDEN_PRODUCTION_OR_SIGNING_PATTERNS) {
    if (pattern.test(account)) {
      return yield* new CloudDevicePolicyError({
        field: 'devAccountHandle',
        reason:
          'Production, personal, or signing accounts are forbidden for cloud Android verification',
      })
    }
  }

  const fixture = input.syntheticFixtureId.trim()
  if (fixture.length === 0) {
    return yield* new CloudDevicePolicyError({
      field: 'syntheticFixtureId',
      reason: 'An approved synthetic fixture identifier is required',
    })
  }
  for (const pattern of FORBIDDEN_PRODUCTION_OR_SIGNING_PATTERNS) {
    if (pattern.test(fixture)) {
      return yield* new CloudDevicePolicyError({
        field: 'syntheticFixtureId',
        reason:
          'Personal or production data fixtures are forbidden for cloud Android verification',
      })
    }
  }

  // Signed presigned R2 download URLs require query parameters (signature/expiry),
  // but still must be HTTPS and non-SSRF.
  yield* assertSafeRemoteHttpsUrl({
    field: 'apkDownloadUrl',
    rawUrl: Redacted.value(input.apkDownloadUrl),
    allowQueryString: true,
  })

  return {
    devAccountHandle: account,
    syntheticFixtureId: fixture,
  } as const
})

export const assertValidArbeoObservation = Effect.fn(
  'AndroidVerificationPolicy.assertValidArbeoObservation',
)(function* (input: {
  readonly expectedApkSha256: Sha256Hex
  readonly observation: ArbeoJourneyObservation
}) {
  const { expectedApkSha256, observation } = input
  if (
    !observation.apkSha256Verified ||
    observation.observedApkSha256 !== expectedApkSha256
  ) {
    return yield* new ApkIntegrityError({
      expectedSha256: expectedApkSha256,
      actualSha256: observation.observedApkSha256,
      reason:
        'Cloud device runner did not verify the exact Stage 1 APK SHA-256 before installation',
    })
  }

  const failures: Array<string> = []
  if (!observation.cleanEmulatorBooted) {
    failures.push('clean emulator boot not confirmed')
  }
  if (!observation.kvmAccelerated) {
    failures.push('KVM hardware acceleration (/dev/kvm) not confirmed')
  }
  if (observation.importPreviewDuration !== EXPECTED_ARBEO_IMPORT_DURATION) {
    failures.push(
      `import preview duration was "${observation.importPreviewDuration}", expected "${EXPECTED_ARBEO_IMPORT_DURATION}"`,
    )
  }
  if (observation.importConfirmedDuration !== EXPECTED_ARBEO_IMPORT_DURATION) {
    failures.push(
      `import confirmed duration was "${observation.importConfirmedDuration}", expected "${EXPECTED_ARBEO_IMPORT_DURATION}"`,
    )
  }
  if (!observation.persistedAfterOfflineRestart) {
    failures.push('entry did not persist after offline restart')
  }
  if (!observation.cleanupConfirmed) {
    failures.push('cloud emulator cleanup not confirmed')
  }

  return {
    passed: failures.length === 0,
    failures,
  } as const
})
