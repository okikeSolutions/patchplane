import { AuthError } from '@patchplane/domain/errors'
import { Effect } from 'effect'
import { mapWorkOSSessionToAuthRequest } from '@patchplane/plugins/workos/session'

export const getWorkOSAuthRequest = Effect.fn('WorkOSAuthRequest.get')(
  function* () {
    const getAuth = yield* Effect.tryPromise({
      try: async () => {
        const authkit = await import('@workos/authkit-tanstack-react-start')
        return authkit.getAuth
      },
      catch: (cause) =>
        new AuthError({
          operation: 'workosAuthRequest.loadAdapter',
          message: 'Unable to load the WorkOS authentication adapter',
          cause,
        }),
    })
    const auth = yield* Effect.tryPromise({
      try: () => getAuth(),
      catch: (cause) =>
        new AuthError({
          operation: 'workosAuthRequest.getAuth',
          message: 'Unable to load the authenticated session',
          cause,
        }),
    })

    if (!auth.user) {
      return mapWorkOSSessionToAuthRequest({ user: null })
    }

    return mapWorkOSSessionToAuthRequest({
      user: auth.user,
      sessionId: auth.sessionId,
      organizationId: auth.organizationId,
      role: auth.role,
      roles: auth.roles,
      permissions: auth.permissions,
      accessToken: auth.accessToken,
    })
  },
)
