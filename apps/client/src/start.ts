import { AuthError } from '@patchplane/domain/errors'
import { Config, Effect } from 'effect'
import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
  type RequestMiddlewareServerFnResult,
} from '@tanstack/react-start'
import { resolveWorkOSRedirectUri } from './lib/workos-redirect-uri'
import { boundedServerFunctionBodyMiddleware } from './lib/server-function-request-bound'

type WorkOSMiddlewareServer = (
  input: unknown,
) => RequestMiddlewareServerFnResult<{}, undefined, undefined>

type MiddlewareWithServer = {
  options: {
    server?: WorkOSMiddlewareServer
  }
}

function hasMiddlewareServer(value: unknown): value is MiddlewareWithServer {
  if (typeof value !== 'object' || value === null || !('options' in value)) {
    return false
  }

  const options = value.options

  return (
    typeof options === 'object' &&
    options !== null &&
    'server' in options &&
    (typeof options.server === 'function' || options.server === undefined)
  )
}

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn',
})

const workosAuthkitMiddleware = createMiddleware().server((args) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { authkitMiddleware } = yield* Effect.tryPromise({
        try: () => import('@workos/authkit-tanstack-react-start'),
        catch: (cause) =>
          new AuthError({
            operation: 'workos.middleware.adapter',
            message: 'WorkOS middleware adapter is unavailable',
            cause,
          }),
      })
      const configuredRedirectUri = yield* Config.String(
        'WORKOS_REDIRECT_URI',
      ).pipe(Config.withDefault(''))
      const middleware: unknown = authkitMiddleware({
        redirectUri: resolveWorkOSRedirectUri(
          args.request,
          configuredRedirectUri,
        ),
      })

      if (hasMiddlewareServer(middleware) && middleware.options.server) {
        const server = middleware.options.server
        return yield* Effect.tryPromise({
          try: () => Promise.resolve(server(args)),
          catch: (cause) =>
            new AuthError({
              operation: 'workos.middleware',
              message: 'WorkOS middleware failed',
              cause,
            }),
        })
      }

      return yield* Effect.tryPromise({
        try: () => Promise.resolve(args.next()),
        catch: (cause) =>
          new AuthError({
            operation: 'workos.middleware.next',
            message: 'Request middleware continuation failed',
            cause,
          }),
      })
    }),
  ),
)

export const startInstance = createStart(() => ({
  requestMiddleware: [
    boundedServerFunctionBodyMiddleware,
    csrfMiddleware,
    workosAuthkitMiddleware,
  ],
}))
