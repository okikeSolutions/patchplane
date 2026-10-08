import { createFileRoute } from '@tanstack/react-router'
import { AuthError } from '@patchplane/domain/errors'
import { Config, Effect } from 'effect'

const configuredOrganizationId = Config.String(
  'PATCHPLANE_WORKOS_ORGANIZATION_ID',
).pipe(
  Config.withDefault(''),
  Config.map((value) => value.trim() || undefined),
)

function sanitizeReturnPathname(value: string | null) {
  if (!value) {
    return undefined
  }

  try {
    const url = new URL(value, 'https://patchplane.local')
    return `/${url.pathname.replace(/^\/+/, '')}${url.search}${url.hash}`
  } catch {
    return undefined
  }
}

export const Route = createFileRoute('/api/auth/sign-in')({
  server: {
    handlers: {
      GET: ({ request }: { request: Request }) =>
        Effect.runPromise(runSignIn(request)),
    },
  },
})

const runSignIn = Effect.fn('WorkOSSignInRoute.run')(function* (
  request: Request,
) {
  const searchParams = new URL(request.url).searchParams
  const returnPathname = sanitizeReturnPathname(
    searchParams.get('returnPathname'),
  )
  const { getSignInUrl } = yield* Effect.tryPromise({
    try: () => import('@workos/authkit-tanstack-react-start'),
    catch: (cause) =>
      new AuthError({
        operation: 'workos.sign-in.adapter',
        message: 'WorkOS sign-in adapter unavailable',
        cause,
      }),
  })
  const organizationId = yield* configuredOrganizationId
  const url = yield* Effect.tryPromise({
    try: () =>
      getSignInUrl({
        data: {
          ...(returnPathname === undefined ? {} : { returnPathname }),
          ...(organizationId === undefined ? {} : { organizationId }),
        },
      }),
    catch: (cause) =>
      new AuthError({
        operation: 'workos.sign-in.url',
        message: 'WorkOS sign-in URL failed',
        cause,
      }),
  })

  return new Response(null, {
    status: 307,
    headers: { Location: url },
  })
})
