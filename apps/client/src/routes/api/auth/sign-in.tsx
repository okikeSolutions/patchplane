import { createFileRoute } from '@tanstack/react-router'
import { getSignInUrl } from '@workos/authkit-tanstack-react-start'

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
      GET: async ({ request }: { request: Request }) => {
        const returnPathname = sanitizeReturnPathname(
          new URL(request.url).searchParams.get('returnPathname'),
        )
        const url =
          returnPathname === undefined
            ? await getSignInUrl()
            : await getSignInUrl({ data: { returnPathname } })

        return new Response(null, {
          status: 307,
          headers: { Location: url },
        })
      },
    },
  },
})
