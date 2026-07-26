import { describe, expect, it } from '@effect/vitest'
import { ConfigProvider, Effect, Exit } from 'effect'
import { loadConfiguredConvexUrl } from './convex-url'

function provideEnv(env: Record<string, string>) {
  return ConfigProvider.layer(ConfigProvider.fromEnv({ env }))
}

describe('client Convex URL configuration', () => {
  it.effect('uses the alias only when the canonical URL is absent', () =>
    Effect.gen(function* () {
      const alias = yield* loadConfiguredConvexUrl().pipe(
        Effect.provide(provideEnv({
          VITE_CONVEX_URL: 'https://legacy.example.convex.cloud',
        })),
      )
      const malformedCanonical = yield* loadConfiguredConvexUrl().pipe(
        Effect.provide(provideEnv({
          CONVEX_URL: 'not a url',
          VITE_CONVEX_URL: 'https://legacy.example.convex.cloud',
        })),
        Effect.exit,
      )

      expect(alias.toString()).toBe('https://legacy.example.convex.cloud/')
      expect(Exit.isFailure(malformedCanonical)).toBe(true)
    }),
  )
})
