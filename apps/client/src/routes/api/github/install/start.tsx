import { layer as BrowserCryptoLayer } from '@effect/platform-browser/BrowserCrypto'
import { createFileRoute } from '@tanstack/react-router'
import { ConvexHttpClient } from 'convex/browser'
import { Crypto, Effect } from 'effect'
import { makeFunctionReference } from 'convex/server'
import { createGitHubInstallStartResponse } from './-install-flow'

const createGitHubConnectionIntent = makeFunctionReference<
  'mutation',
  {
    state: string
    workspaceId: string
    returnPathname?: string
    expiresAt: number
  },
  { state: string }
>('connectedRepositories:createGitHubConnectionIntent')

function configuredConvexUrl() {
  const value = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL
  if (value === undefined || value.trim().length === 0) {
    throw new Error('CONVEX_URL or VITE_CONVEX_URL is required')
  }
  return value.replace(/\/$/, '')
}

function randomInstallState() {
  return Effect.runPromise(
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto
      return yield* crypto.randomUUIDv4
    }).pipe(Effect.provide(BrowserCryptoLayer)),
  )
}

function configuredGitHubInstallUrl() {
  const explicitUrl = process.env.PATCHPLANE_GITHUB_APP_INSTALL_URL?.trim()
  if (explicitUrl) {
    return explicitUrl
  }

  const slug = process.env.PATCHPLANE_GITHUB_APP_SLUG?.trim()
  if (!slug) {
    throw new Error('PATCHPLANE_GITHUB_APP_INSTALL_URL or PATCHPLANE_GITHUB_APP_SLUG is required')
  }

  return `https://github.com/apps/${slug}/installations/new`
}

export const Route = createFileRoute('/api/github/install/start')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        if (!import.meta.env.SSR) {
          return new Response('GitHub installation start is server-only', { status: 404 })
        }

        const { getAuth } = await import('@workos/authkit-tanstack-react-start')
        const auth = await getAuth()
        const state = await randomInstallState()

        const organizationId = 'organizationId' in auth ? auth.organizationId : undefined
        const accessToken = 'accessToken' in auth ? auth.accessToken : undefined

        return createGitHubInstallStartResponse({
          auth: {
            hasUser: Boolean(auth.user),
            organizationId,
            accessToken,
          },
          requestUrl: request.url,
          state,
          installUrl: configuredGitHubInstallUrl(),
          createIntent: async (intent) => {
            const convex = new ConvexHttpClient(configuredConvexUrl())
            convex.setAuth(accessToken!)
            await convex.mutation(createGitHubConnectionIntent, intent)
          },
        })
      },
    },
  },
})
