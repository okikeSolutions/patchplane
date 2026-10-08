import { createServerFn } from '@tanstack/react-start'
import { AuthError } from '@patchplane/domain/errors'
import { Effect } from 'effect'

export const loadInitialAuth = Effect.fn('WorkOSInitialAuth.load')(
  function* () {
    const fetchAuth = yield* Effect.tryPromise({
      try: () =>
        import('@workos/authkit-tanstack-react-start').then(
          ({ getAuth }) => getAuth,
        ),
      catch: (cause) =>
        new AuthError({
          operation: 'workos.initial-auth.adapter',
          message: 'WorkOS initial authentication adapter is unavailable',
          cause,
        }),
    })
    return yield* Effect.tryPromise({
      try: () => fetchAuth(),
      catch: (cause) =>
        new AuthError({
          operation: 'workos.initial-auth',
          message: 'WorkOS initial authentication failed',
          cause,
        }),
    })
  },
)

export const getInitialAuthServerFn = createServerFn({ method: 'GET' }).handler(
  () => Effect.runPromise(loadInitialAuth()),
)
