import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit } from 'effect'
import { RuntimeService } from '@patchplane/core/services/runtime-service'
import { PiAgentRuntimePlugin } from './PiAgentRuntimePlugin'

describe('PiAgentRuntimePlugin', () => {
  it.effect('returns a RuntimeError when steering has no active runtime', () =>
    Effect.gen(function* () {
      const runtime = yield* RuntimeService
      const exit = yield* Effect.exit(
        runtime.steer({ traceId: 'missing-trace', message: 'stop' }),
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(String(exit.cause)).toContain('RuntimeError')
      }
    }).pipe(Effect.provide(PiAgentRuntimePlugin.layer)),
  )

  it.effect('returns a RuntimeError when abort has no active runtime', () =>
    Effect.gen(function* () {
      const runtime = yield* RuntimeService
      const exit = yield* Effect.exit(runtime.abort({ traceId: 'missing-trace' }))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(String(exit.cause)).toContain('RuntimeError')
      }
    }).pipe(Effect.provide(PiAgentRuntimePlugin.layer)),
  )
})
