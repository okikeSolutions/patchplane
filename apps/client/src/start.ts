import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
  type RequestMiddlewareServerFnResult,
} from '@tanstack/react-start'

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

function authRedirectUri(request: Request) {
  const url = new URL(request.url)
  return `${url.origin}/api/auth/callback`
}

const workosAuthkitMiddleware = createMiddleware().server(async (args) => {
  const { authkitMiddleware } =
    await import('@workos/authkit-tanstack-react-start')
  const middleware: unknown = authkitMiddleware({
    redirectUri: authRedirectUri(args.request),
  })

  if (hasMiddlewareServer(middleware) && middleware.options.server) {
    return middleware.options.server(args)
  }

  return args.next()
})

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, workosAuthkitMiddleware],
}))
