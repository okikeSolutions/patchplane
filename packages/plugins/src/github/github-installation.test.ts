import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit } from 'effect'
import { parseGitHubInstallationId } from './github-installation'

describe('parseGitHubInstallationId', () => {
  it.effect('accepts positive safe GitHub installation ids', () =>
    Effect.gen(function* () {
      const installationId = yield* parseGitHubInstallationId({
        provider: 'github',
        installationId: '123',
      })

      expect(installationId).toBe(123)
    }),
  )

  it.effect('rejects non-positive installation ids', () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(parseGitHubInstallationId({
        provider: 'github',
        installationId: '0',
      }))

      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )
})
