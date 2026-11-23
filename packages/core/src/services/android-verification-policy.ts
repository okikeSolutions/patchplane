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

/** Explicit MIME allowlist for untrusted Stage 2 diagnostic artifacts. */
export const ALLOWED_STAGE2_ARTIFACT_CONTENT_TYPES: ReadonlySet<string> =
  new Set([
    'image/png',
    'image/jpeg',
    'text/plain',
    'text/plain; charset=utf-8',
    'application/json',
    'application/json; charset=utf-8',
  ])

/**
 * Forbids personal-machine, local, laptop, and developer-Mac targets while
 * allowing dedicated cloud KVM/SimLock worker pools (`cloud-*` with
 * `executionEnvironment: 'cloud-isolated'`).
 */
const FORBIDDEN_PERSONAL_DEVICE_PATTERNS: ReadonlyArray<RegExp> = [
  /(?:^|[-_.])local(?:[-_.]|$)/i,
  /localdevice/i,
  /localhost/i,
  /127\.0\.0\.1/,
  /personal/i,
  /laptop/i,
  /macbook/i,
  /developer[-_]?mac/i,
  /physical[-_]?device/i,
  /usb[-_]?adb/i,
  /xcrun/i,
]

const FORBIDDEN_PRODUCTION_OR_SIGNING_PATTERNS: ReadonlyArray<RegExp> = [
  /keystore/i,
  /signing/i,
  /release[-_]?key/i,
  /play[-_]?store/i,
  /google[-_]?play/i,
  /(?:^|[-_:.@/])prod(?:uction)?(?:[-_:.@/]|$)/i,
  /personal/i,
  /@(?:gmail|icloud|me|yahoo|outlook|hotmail|live|protonmail|proton)\./i,
]

const SAFE_IDENTIFIER_ARG = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,127}$/
const SAFE_SANDBOX_FILE_PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

const isPrivateOrReservedIpv4 = (host: string): boolean => {
  const parts = host.split('.')
  if (parts.length !== 4) return false
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : -1))
  if (nums.some((n) => n < 0 || n > 255)) return false
  const [a = -1, b = -1] = nums
  return (
    a === 0 || // 0.0.0.0/8
    a === 10 || // 10.0.0.0/8
    a === 127 || // 127.0.0.0/8 loopback
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT / cloud VPC metadata
    (a === 169 && b === 254) || // 169.254.0.0/16 link-local / cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) || // 192.168.0.0/16
    a >= 224 // multicast / reserved
  )
}

const isPrivateOrReservedHost = (rawHostname: string): boolean => {
  const host = rawHostname.replace(/\.+$/, '').toLowerCase()
  if (
    host.length === 0 ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true
  }
  if (isPrivateOrReservedIpv4(host)) return true

  // Bracketed IPv6 literal (WHATWG URL normalizes IPv6-mapped IPv4 to hex form)
  if (host.startsWith('[') && host.endsWith(']')) {
    const ipv6 = host.slice(1, -1)
    if (
      ipv6 === '::' ||
      ipv6 === '::1' ||
      ipv6.startsWith('::ffff:') || // IPv4-mapped IPv6 (e.g. ::ffff:7f00:1 / ::ffff:a9fe:a9fe)
      /^f[cd][0-9a-f]{2}:/.test(ipv6) || // fc00::/7 ULA
      /^fe[89ab][0-9a-f]:/.test(ipv6) || // fe80::/10 link-local
      ipv6.startsWith('ff') // multicast
    ) {
      return true
    }
  }
  return false
}

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
  // Allow dedicated cloud SimLock pools only when explicitly cloud-scoped;
  // forbid bare/personal/local SimLock targets.
  if (
    /simlock/i.test(input.providerId) &&
    !/^cloud[-_]/i.test(input.providerId)
  ) {
    return yield* new CloudDevicePolicyError({
      field: 'providerId',
      reason: `Personal or non-cloud SimLock provider "${input.providerId}" is forbidden by security-by-design policy`,
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

const validateHttpsUrl = (
  field: string,
  rawUrl: string,
  allowQueryString: boolean,
) =>
  Effect.gen(function* () {
    const safeField = field.trim().length > 0 ? field.trim() : 'url'
    const parsed = yield* Effect.try({
      try: () => new URL(rawUrl),
      catch: () =>
        new CloudDevicePolicyError({
          field: safeField,
          reason: `${safeField} must be a valid HTTPS URL`,
        }),
    })
    if (parsed.protocol !== 'https:') {
      return yield* new CloudDevicePolicyError({
        field: safeField,
        reason: `${safeField} must use https://`,
      })
    }
    if (parsed.port !== '' && parsed.port !== '443') {
      return yield* new CloudDevicePolicyError({
        field: safeField,
        reason: `${safeField} must use standard HTTPS port 443`,
      })
    }
    if (parsed.username.length > 0 || parsed.password.length > 0) {
      return yield* new CloudDevicePolicyError({
        field: safeField,
        reason: `${safeField} must not embed credentials`,
      })
    }
    if (parsed.hash.length > 0) {
      return yield* new CloudDevicePolicyError({
        field: safeField,
        reason: `${safeField} must not include a URL fragment`,
      })
    }
    if (!allowQueryString && parsed.search.length > 0) {
      return yield* new CloudDevicePolicyError({
        field: safeField,
        reason: `${safeField} must not include query parameters`,
      })
    }
    if (isPrivateOrReservedHost(parsed.hostname)) {
      return yield* new CloudDevicePolicyError({
        field: safeField,
        reason: `${safeField} host "${parsed.hostname}" is not permitted`,
      })
    }
    return parsed.toString()
  })

/**
 * Validates a `Redacted` HTTPS URL without returning the unwrapped secret URL.
 */
export const assertSafeRedactedHttpsUrl = Effect.fn(
  'AndroidVerificationPolicy.assertSafeRedactedHttpsUrl',
)(function* (input: {
  readonly field: string
  readonly url: Redacted.Redacted
  readonly allowQueryString: boolean
}) {
  yield* validateHttpsUrl(
    input.field,
    Redacted.value(input.url),
    input.allowQueryString,
  )
})

export const assertSafeApkOutputPath = Effect.fn(
  'AndroidVerificationPolicy.assertSafeApkOutputPath',
)(function* (apkPath: string) {
  const trimmed = apkPath.trim()
  if (
    trimmed.length === 0 ||
    trimmed.startsWith('/') ||
    trimmed.endsWith('/') ||
    !SAFE_SANDBOX_FILE_PATH.test(trimmed) ||
    !trimmed.endsWith('.apk') ||
    trimmed.split('/').some((seg) => seg === '' || seg === '..' || seg === '.')
  ) {
    return yield* new CloudDevicePolicyError({
      field: 'apkOutputPath',
      reason:
        'APK output path must be a relative .apk path without leading "/", empty segments, or traversal',
    })
  }
  return trimmed
})

export const assertDedicatedDevAccountAndSyntheticFixture = Effect.fn(
  'AndroidVerificationPolicy.assertDedicatedDevAccountAndSyntheticFixture',
)(function* (input: {
  readonly devAccountHandle: string
  readonly syntheticFixtureId: string
  readonly apkDownloadUrl?: Redacted.Redacted
}) {
  const account = input.devAccountHandle.trim()
  if (!SAFE_IDENTIFIER_ARG.test(account)) {
    return yield* new CloudDevicePolicyError({
      field: 'devAccountHandle',
      reason:
        'Dedicated dev account handle must be a safe non-flag identifier (no leading "-" or whitespace)',
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
  if (!SAFE_IDENTIFIER_ARG.test(fixture)) {
    return yield* new CloudDevicePolicyError({
      field: 'syntheticFixtureId',
      reason:
        'Approved synthetic fixture ID must be a safe non-flag identifier (no leading "-" or whitespace)',
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

  if (input.apkDownloadUrl !== undefined) {
    yield* assertSafeRedactedHttpsUrl({
      field: 'apkDownloadUrl',
      url: input.apkDownloadUrl,
      allowQueryString: true,
    })
  }

  return {
    devAccountHandle: account,
    syntheticFixtureId: fixture,
  } as const
})

export const assertAllowedStage2ContentType = Effect.fn(
  'AndroidVerificationPolicy.assertAllowedStage2ContentType',
)(function* (contentType: string) {
  const normalized = contentType.trim().toLowerCase()
  if (!ALLOWED_STAGE2_ARTIFACT_CONTENT_TYPES.has(normalized)) {
    return yield* new CloudDevicePolicyError({
      field: 'contentType',
      reason: `Stage 2 artifact content type "${contentType}" is not in the allowed diagnostic MIME list`,
    })
  }
  return contentType
})

/**
 * Evaluates provider-neutral Arbeo journey assertions (`+05:00` preview &
 * confirmation, offline-restart persistence, clean emulator boot, verified
 * cleanup, and exact APK SHA-256). Hardware-specific checks (such as Linux
 * `/dev/kvm`) are enforced by the concrete cloud provider adapter so Expo
 * Simulators and dedicated cloud pools plug in with zero core changes.
 */
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
