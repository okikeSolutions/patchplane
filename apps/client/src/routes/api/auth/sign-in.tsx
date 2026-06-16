import { createFileRoute } from '@tanstack/react-router'

function configuredOrganizationId() {
  const value = process.env.PATCHPLANE_WORKOS_ORGANIZATION_ID?.trim()
  return value ? value : undefined
}

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
        const searchParams = new URL(request.url).searchParams
        const returnPathname = sanitizeReturnPathname(
          searchParams.get('returnPathname'),
        )
        const { getSignInUrl } =
          await import('@workos/authkit-tanstack-react-start')
        const organizationId = configuredOrganizationId()
        const url = await getSignInUrl({
          data: {
            ...(returnPathname === undefined ? {} : { returnPathname }),
            ...(organizationId === undefined ? {} : { organizationId }),
          },
        })

        return new Response(null, {
          status: 307,
          headers: { Location: url },
        })
      },
    },
  },
})
