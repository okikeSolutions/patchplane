import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit, Option, Redacted } from 'effect'
import { loadSourceControlRouteConfig } from './config'

const requiredEnv = {
  CONVEX_URL: 'https://example.convex.cloud',
  PATCHPLANE_GITHUB_ALLOWED_REPOSITORIES: 'patchplane/repo',
}

describe('source-control route config', () => {
  it.effect('rejects malformed Convex URLs', () =>
    Effect.gen(function* () {
      const exit = yield* loadSourceControlRouteConfig({
        ...requiredEnv,
        CONVEX_URL: 'not a url',
      }).pipe(Effect.exit)
      const aliasExit = yield* loadSourceControlRouteConfig({
        ...requiredEnv,
        CONVEX_URL: 'not a url',
        VITE_CONVEX_URL: 'https://legacy.example.convex.cloud',
      }).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      expect(Exit.isFailure(aliasExit)).toBe(true)
    }),
  )

  it.effect('rejects unknown execution and Pi modes', () =>
    Effect.gen(function* () {
      const executionExit = yield* loadSourceControlRouteConfig({
        ...requiredEnv,
        PATCHPLANE_GITHUB_WEBHOOK_EXECUTION: 'typo',
      }).pipe(Effect.exit)
      const piModeExit = yield* loadSourceControlRouteConfig({
        ...requiredEnv,
        PATCHPLANE_PI_MODE: 'typo',
      }).pipe(Effect.exit)

      expect(Exit.isFailure(executionExit)).toBe(true)
      expect(Exit.isFailure(piModeExit)).toBe(true)
    }),
  )

  it.effect('keeps the optional Cloudflare API key redacted', () =>
    Effect.gen(function* () {
      const config = yield* loadSourceControlRouteConfig({
        ...requiredEnv,
        CLOUDFLARE_API_KEY: 'secret-value',
      })

      expect(Option.isSome(config.cloudflareApiKey)).toBe(true)
      if (Option.isSome(config.cloudflareApiKey)) {
        expect(Redacted.value(config.cloudflareApiKey.value)).toBe('secret-value')
        expect(String(config.cloudflareApiKey.value)).not.toContain('secret-value')
      }
    }),
  )
})
