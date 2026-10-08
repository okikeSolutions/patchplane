import { Effect } from 'effect'
import { it } from '@effect/vitest'
import { afterEach, describe, expect, vi } from 'vitest'

const authkit = vi.hoisted(() => ({
  getAuth: vi.fn(),
}))

vi.mock('@workos/authkit-tanstack-react-start', () => authkit)

import { loadInitialAuth } from './workos-initial-auth'

afterEach(() => {
  authkit.getAuth.mockReset()
})

describe('loadInitialAuth', () => {
  it.effect('returns the WorkOS session without changing its identity', () =>
    Effect.gen(function* () {
      const session = { user: null }
      authkit.getAuth.mockResolvedValue(session)
      expect(yield* loadInitialAuth()).toBe(session)
    }),
  )

  it.effect('maps WorkOS session failures into an application auth error', () =>
    Effect.gen(function* () {
      authkit.getAuth.mockRejectedValue(new Error('provider details'))
      const error = yield* Effect.flip(loadInitialAuth())
      expect(error).toMatchObject({
        _tag: 'AuthError',
        operation: 'workos.initial-auth',
      })
    }),
  )
})
