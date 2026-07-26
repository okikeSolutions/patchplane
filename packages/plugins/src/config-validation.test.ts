import { describe, expect, it } from '@effect/vitest'
import { ConfigProvider, Effect, Exit } from 'effect'
import { R2ArtifactsConfig } from './cloudflare/R2ArtifactsConfig'
import { DaytonaConfig } from './daytona/DaytonaConfig'
import { SentryConfig } from './sentry/SentryConfig'
import { piRuntimeEnvironment } from './sandbox-runtime/pi/config'

function provideEnv(env: Record<string, string>) {
  return ConfigProvider.layer(ConfigProvider.fromEnv({ env }))
}

describe('provider configuration validation', () => {
  it.effect('rejects non-positive Daytona resources', () =>
    Effect.gen(function* () {
      const exit = yield* DaytonaConfig.pipe(
        Effect.provide(provideEnv({
          DAYTONA_API_KEY: 'secret',
          DAYTONA_RESOURCE_CPU: '0',
        })),
        Effect.exit,
      )

      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.effect('rejects unknown Pi providers instead of selecting the OpenAI key', () =>
    Effect.gen(function* () {
      const exit = yield* piRuntimeEnvironment({ provider: 'opneai' }).pipe(
        Effect.provide(provideEnv({ OPENAI_API_KEY: 'secret' })),
        Effect.exit,
      )

      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.effect('rejects invalid Sentry environments and trace sample rates', () =>
    Effect.gen(function* () {
      const environmentExit = yield* SentryConfig.pipe(
        Effect.provide(provideEnv({ SENTRY_ENVIRONMENT: 'prodution' })),
        Effect.exit,
      )
      const sampleRateExit = yield* SentryConfig.pipe(
        Effect.provide(provideEnv({ SENTRY_TRACES_SAMPLE_RATE: '1.1' })),
        Effect.exit,
      )

      expect(Exit.isFailure(environmentExit)).toBe(true)
      expect(Exit.isFailure(sampleRateExit)).toBe(true)
    }),
  )

  it.effect('rejects invalid R2 endpoints, expiry, and artifact limits', () =>
    Effect.gen(function* () {
      const base = {
        CLOUDFLARE_ACCOUNT_ID: 'account',
        PATCHPLANE_EVIDENCE_R2_BUCKET: 'bucket',
      }
      const endpointExit = yield* R2ArtifactsConfig.pipe(
        Effect.provide(provideEnv({
          ...base,
          CLOUDFLARE_S3_API_ENDPOINT: 'not a url',
        })),
        Effect.exit,
      )
      const expiryExit = yield* R2ArtifactsConfig.pipe(
        Effect.provide(provideEnv({
          ...base,
          PATCHPLANE_EVIDENCE_R2_SIGNED_URL_EXPIRES_SECONDS: '0',
        })),
        Effect.exit,
      )
      const sizeExit = yield* R2ArtifactsConfig.pipe(
        Effect.provide(provideEnv({
          ...base,
          PATCHPLANE_EVIDENCE_MAX_ARTIFACT_BYTES: '-1',
        })),
        Effect.exit,
      )

      expect(Exit.isFailure(endpointExit)).toBe(true)
      expect(Exit.isFailure(expiryExit)).toBe(true)
      expect(Exit.isFailure(sizeExit)).toBe(true)
    }),
  )
})
