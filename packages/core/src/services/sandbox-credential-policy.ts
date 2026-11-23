import { Clock, Effect } from 'effect'
import * as Redacted from 'effect/Redacted'
import {
  type ChangeRequestId,
  SandboxCredentialPolicyError,
  type VerificationAttemptId,
} from '@patchplane/domain'

export const PATCHPLANE_MANAGED_LABEL = 'patchplane.managed'
export const PATCHPLANE_ATTEMPT_ID_LABEL = 'patchplane.attempt_id'
export const PATCHPLANE_CHANGE_REQUEST_ID_LABEL = 'patchplane.change_request_id'
export const PATCHPLANE_PURPOSE_LABEL = 'patchplane.purpose'

export const SANDBOX_ATTEMPT_ID_ENV = 'PATCHPLANE_ATTEMPT_ID'
export const SANDBOX_MODEL_TOKEN_ENV = 'PATCHPLANE_ATTEMPT_MODEL_TOKEN'
export const SANDBOX_MODEL_GATEWAY_URL_ENV = 'PATCHPLANE_MODEL_GATEWAY_URL'

/** Maximum lifetime for an attempt-scoped verifier model credential (45 min). */
export const MAX_MODEL_CREDENTIAL_TTL_MS = 45 * 60 * 1000

const ALLOWED_SANDBOX_ENV_KEYS = new Set([
  SANDBOX_ATTEMPT_ID_ENV,
  SANDBOX_MODEL_TOKEN_ENV,
  SANDBOX_MODEL_GATEWAY_URL_ENV,
])

const FORBIDDEN_CREDENTIAL_PATTERNS: ReadonlyArray<RegExp> = [
  /^WORKOS_/i,
  /^GITHUB_/i,
  /^DATABASE_URL/i,
  /^PG(?:HOST|PORT|USER|PASSWORD|DATABASE|PASSFILE|SSL)/i,
  /^POSTGRES/i,
  /^NEON_/i,
  /^CLOUDFLARE_/i,
  /^DAYTONA_/i,
  /^ALCHEMY_/i,
  /^PATCHPLANE_SYSTEM_/i,
  /^SENTRY_/i,
  /^OPENAI_API_KEY$/i,
  /^ANTHROPIC_API_KEY$/i,
  /^GOOGLE_API_KEY$/i,
  /^GEMINI_API_KEY$/i,
  /(?:PRIVATE_KEY|WEBHOOK_SECRET|COOKIE_PASSWORD|ACCESS_KEY_ID|SECRET_ACCESS_KEY|INGESTION_SECRET)/i,
]

export interface ShortLivedAttemptModelCredential {
  readonly token: Redacted.Redacted
  readonly attemptId: VerificationAttemptId
  readonly expiresAtMs: number
  readonly gatewayUrl?: string
}

const ValidatedSandboxEnvBrand = Symbol('ValidatedSandboxEnv')

/**
 * Policy-validated sandbox environment inputs. Only constructible through
 * `buildValidatedSandboxEnv`, guaranteeing control-plane secrets cannot enter
 * sandbox creation requests.
 */
export interface ValidatedSandboxEnv {
  readonly [ValidatedSandboxEnvBrand]: true
  readonly attemptId: VerificationAttemptId
  readonly modelToken: Redacted.Redacted
  readonly gatewayUrl?: string
  readonly envKeys: ReadonlyArray<string>
}

export const buildAttemptSandboxLabels = (input: {
  readonly attemptId: VerificationAttemptId
  readonly changeRequestId: ChangeRequestId
  readonly purpose?: string
}): Readonly<Record<string, string>> => ({
  [PATCHPLANE_MANAGED_LABEL]: 'true',
  [PATCHPLANE_ATTEMPT_ID_LABEL]: input.attemptId,
  [PATCHPLANE_CHANGE_REQUEST_ID_LABEL]: input.changeRequestId,
  [PATCHPLANE_PURPOSE_LABEL]: input.purpose ?? 'verification',
})

export const assertAllowedSandboxEnvKey = Effect.fn(
  'SandboxCredentialPolicy.assertAllowedEnvKey',
)(function* (key: string) {
  for (const pattern of FORBIDDEN_CREDENTIAL_PATTERNS) {
    if (pattern.test(key)) {
      return yield* new SandboxCredentialPolicyError({
        key: key.length > 0 ? key : '<empty>',
        reason: `Control-plane or provider credential "${key}" is forbidden in sandbox inputs`,
      })
    }
  }
  if (!ALLOWED_SANDBOX_ENV_KEYS.has(key)) {
    return yield* new SandboxCredentialPolicyError({
      key: key.length > 0 ? key : '<empty>',
      reason: `Environment key "${key}" is not on the sandbox allowlist`,
    })
  }
  return yield* Effect.void
})

/**
 * Validates that sandbox inputs contain ONLY a short-lived, attempt-scoped
 * model credential and zero WorkOS, GitHub App, Postgres, Neon, Cloudflare,
 * Daytona, or control-plane credentials.
 */
export const buildValidatedSandboxEnv = Effect.fn(
  'SandboxCredentialPolicy.buildValidatedSandboxEnv',
)(function* (input: {
  readonly attemptId: VerificationAttemptId
  readonly modelCredential: ShortLivedAttemptModelCredential
  readonly extraEnv?: Readonly<Record<string, string | Redacted.Redacted>>
}) {
  if (input.extraEnv !== undefined) {
    for (const key of Object.keys(input.extraEnv)) {
      yield* assertAllowedSandboxEnvKey(key)
    }
  }

  if (input.modelCredential.attemptId !== input.attemptId) {
    return yield* new SandboxCredentialPolicyError({
      key: SANDBOX_MODEL_TOKEN_ENV,
      reason: 'Model credential attempt scope does not match target attemptId',
    })
  }

  if (Redacted.value(input.modelCredential.token).trim().length === 0) {
    return yield* new SandboxCredentialPolicyError({
      key: SANDBOX_MODEL_TOKEN_ENV,
      reason: 'Attempt-scoped model credential must not be empty',
    })
  }

  const now = yield* Clock.currentTimeMillis
  const ttlMs = input.modelCredential.expiresAtMs - now
  if (ttlMs <= 0) {
    return yield* new SandboxCredentialPolicyError({
      key: SANDBOX_MODEL_TOKEN_ENV,
      reason: 'Attempt-scoped model credential is already expired',
    })
  }
  if (ttlMs > MAX_MODEL_CREDENTIAL_TTL_MS) {
    return yield* new SandboxCredentialPolicyError({
      key: SANDBOX_MODEL_TOKEN_ENV,
      reason: `Attempt-scoped model credential TTL exceeds maximum (${MAX_MODEL_CREDENTIAL_TTL_MS}ms)`,
    })
  }

  if (input.modelCredential.gatewayUrl !== undefined) {
    const parsed = yield* Effect.try({
      try: () => new URL(input.modelCredential.gatewayUrl ?? ''),
      catch: () =>
        new SandboxCredentialPolicyError({
          key: SANDBOX_MODEL_GATEWAY_URL_ENV,
          reason: 'Model gateway URL must be a valid https URL',
        }),
    })
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      return yield* new SandboxCredentialPolicyError({
        key: SANDBOX_MODEL_GATEWAY_URL_ENV,
        reason:
          'Model gateway URL must use https and must not embed userinfo credentials',
      })
    }
  }

  const envKeys = [
    SANDBOX_ATTEMPT_ID_ENV,
    SANDBOX_MODEL_TOKEN_ENV,
    ...(input.modelCredential.gatewayUrl !== undefined
      ? [SANDBOX_MODEL_GATEWAY_URL_ENV]
      : []),
  ]

  const validated: ValidatedSandboxEnv = {
    [ValidatedSandboxEnvBrand]: true,
    attemptId: input.attemptId,
    modelToken: input.modelCredential.token,
    ...(input.modelCredential.gatewayUrl !== undefined
      ? { gatewayUrl: input.modelCredential.gatewayUrl }
      : {}),
    envKeys,
  }
  return validated
})
