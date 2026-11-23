import { describe, expect, it } from '@effect/vitest'
import { Clock, Effect, Schema } from 'effect'
import * as Redacted from 'effect/Redacted'
import { ArtifactKey, VerificationAttemptId } from '@patchplane/domain'
import {
  buildValidatedSandboxEnv,
  MAX_MODEL_CREDENTIAL_TTL_MS,
  SANDBOX_MODEL_TOKEN_ENV,
} from './sandbox-credential-policy'

describe('Sandbox credential policy & identifier safety', () => {
  it.effect(
    'rejects WorkOS, GitHub App, Postgres, Neon, Cloudflare, Daytona, control-plane, and override env keys',
    () =>
      Effect.gen(function* () {
        const attemptId = yield* Schema.decodeEffect(VerificationAttemptId)(
          'attempt-policy-unit',
        )
        const now = yield* Clock.currentTimeMillis
        const validCredential = {
          token: Redacted.make('pp_attempt_model_short_lived_tok'),
          attemptId,
          expiresAtMs: now + 10 * 60 * 1000,
        }

        const forbiddenKeys = [
          'WORKOS_API_KEY',
          'WORKOS_COOKIE_PASSWORD',
          'GITHUB_PRIVATE_KEY',
          'GITHUB_WEBHOOK_SECRET',
          'DATABASE_URL',
          'PGPASSWORD',
          'NEON_API_KEY',
          'CLOUDFLARE_API_TOKEN',
          'DAYTONA_API_KEY',
          'PATCHPLANE_SYSTEM_INGESTION_SECRET',
          'OPENAI_API_KEY',
          'CUSTOM_UNALLOWLISTED_VAR',
          SANDBOX_MODEL_TOKEN_ENV,
        ]

        for (const key of forbiddenKeys) {
          const failure = yield* Effect.flip(
            buildValidatedSandboxEnv({
              attemptId,
              modelCredential: validCredential,
              extraEnv: { [key]: Redacted.make('forbidden') },
            }),
          )
          expect(failure._tag).toBe('SandboxCredentialPolicyError')
        }
      }),
  )

  it.effect(
    'rejects NaN/Infinity/expired/over-TTL model tokens, mismatched attempt scope, and unsafe gateway URLs',
    () =>
      Effect.gen(function* () {
        const attemptId = yield* Schema.decodeEffect(VerificationAttemptId)(
          'attempt-policy-ttl',
        )
        const otherAttemptId = yield* Schema.decodeEffect(
          VerificationAttemptId,
        )('attempt-other')
        const now = yield* Clock.currentTimeMillis

        for (const badExpiry of [
          Number.NaN,
          Number.POSITIVE_INFINITY,
          now - 1_000,
          now + MAX_MODEL_CREDENTIAL_TTL_MS + 60_000,
        ]) {
          const failure = yield* Effect.flip(
            buildValidatedSandboxEnv({
              attemptId,
              modelCredential: {
                token: Redacted.make('tok'),
                attemptId,
                expiresAtMs: badExpiry,
              },
            }),
          )
          expect(failure._tag).toBe('SandboxCredentialPolicyError')
        }

        const wrongScope = yield* Effect.flip(
          buildValidatedSandboxEnv({
            attemptId,
            modelCredential: {
              token: Redacted.make('tok'),
              attemptId: otherAttemptId,
              expiresAtMs: now + 5 * 60 * 1000,
            },
          }),
        )
        expect(wrongScope._tag).toBe('SandboxCredentialPolicyError')

        for (const badGateway of [
          'http://gateway.patchplane.dev/v1',
          'https://user:pass@gateway.patchplane.dev/v1',
          'https://gateway.patchplane.dev/v1?api_key=leak',
          'https://169.254.169.254/latest/meta-data',
          'https://127.0.0.1/v1',
          'https://localhost/v1',
          'https://db.internal/v1',
        ]) {
          const failure = yield* Effect.flip(
            buildValidatedSandboxEnv({
              attemptId,
              modelCredential: {
                token: Redacted.make('tok'),
                attemptId,
                expiresAtMs: now + 5 * 60 * 1000,
                gatewayUrl: badGateway,
              },
            }),
          )
          expect(failure._tag).toBe('SandboxCredentialPolicyError')
        }

        const accepted = yield* buildValidatedSandboxEnv({
          attemptId,
          modelCredential: {
            token: Redacted.make('pp_attempt_short_lived_tok'),
            attemptId,
            expiresAtMs: now + 10 * 60 * 1000,
            gatewayUrl: 'https://gateway.patchplane.dev/v1',
          },
        })
        expect(accepted.attemptId).toBe(attemptId)
        expect(accepted.gatewayUrl).toBe('https://gateway.patchplane.dev/v1')
      }),
  )

  it.effect(
    'rejects path traversal and control characters in VerificationAttemptId and ArtifactKey',
    () =>
      Effect.gen(function* () {
        for (const badAttempt of ['../escape', 'a/b', 'attempt\n1', '']) {
          const err = yield* Effect.flip(
            Schema.decodeEffect(VerificationAttemptId)(badAttempt),
          )
          expect(err._tag).toBe('SchemaError')
        }
        for (const badKey of [
          '/leading-slash',
          'attempts/../other/log.txt',
          'attempts\\win\\log.txt',
          'attempts/a\r\n/log.txt',
        ]) {
          const err = yield* Effect.flip(
            Schema.decodeEffect(ArtifactKey)(badKey),
          )
          expect(err._tag).toBe('SchemaError')
        }
      }),
  )
})
