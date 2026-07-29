import { describe, expect, it } from '@effect/vitest'
import { ConfigProvider, Effect, Redacted, Result } from 'effect'
import { GitHubConfig } from './GitHubConfig'

const baseEnv = {
  GITHUB_PRIVATE_KEY: 'private-key',
  GITHUB_WEBHOOK_SECRET: 'webhook-secret',
}

describe('GitHubConfig', () => {
  it.effect('accepts a bounded GitHub App client ID as JWT issuer', () =>
    Effect.gen(function* () {
      const config = yield* GitHubConfig
      expect(config.appId).toBe('Iv23liWvIRLb5iILIw2p')
      expect(Redacted.value(config.privateKey)).toBe('private-key')
    }).pipe(
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromEnv({
            env: { ...baseEnv, GITHUB_APP_ID: 'Iv23liWvIRLb5iILIw2p' },
          }),
        ),
      ),
    ),
  )

  it.effect('rejects an unbounded GitHub App issuer', () =>
    Effect.gen(function* () {
      const result = yield* GitHubConfig.pipe(Effect.result)
      expect(Result.isFailure(result)).toBe(true)
    }).pipe(
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromEnv({
            env: { ...baseEnv, GITHUB_APP_ID: 'not-an-app-id' },
          }),
        ),
      ),
    ),
  )
})
