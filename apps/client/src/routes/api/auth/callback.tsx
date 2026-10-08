import { createFileRoute } from '@tanstack/react-router'
import { AuthError } from '@patchplane/domain/errors'
import { Effect } from 'effect'

export const Route = createFileRoute('/api/auth/callback')({
  server: {
    handlers: {
      GET: (args) =>
        Effect.runPromise(
          Effect.tryPromise({
            try: () =>
              import('@workos/authkit-tanstack-react-start').then(
                ({ handleCallbackRoute }) =>
                  handleCallbackRoute({ errorRedirectUrl: '/?auth=failed' })(
                    args,
                  ),
              ),
            catch: (cause) =>
              new AuthError({
                operation: 'workos.callback',
                message: 'WorkOS callback handling failed',
                cause,
              }),
          }),
        ),
    },
  },
})
