import { layer as BrowserCryptoLayer } from '@effect/platform-browser/BrowserCrypto'
import { createFileRoute } from '@tanstack/react-router'
import { ConvexHttpClient } from 'convex/browser'
import { Config, Crypto, Effect } from 'effect'
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

const GitHubInstallStartConfig = Config.all({
  convexUrl: Config.nonEmptyString('CONVEX_URL').pipe(
    Config.orElse(() => Config.nonEmptyString('VITE_CONVEX_URL')),
    Config.map((value) => value.replace(/\/$/, '')),
  ),
  installUrl: Config.nonEmptyString('PATCHPLANE_GITHUB_APP_INSTALL_URL').pipe(
    Config.orElse(() => Config.nonEmptyString('PATCHPLANE_GITHUB_APP_SLUG').pipe(
      Config.map((slug) => `https://github.com/apps/${slug}/installations/new`),
    )),
  ),
})

function randomInstallState() {
  return Effect.runPromise(
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto
      return yield* crypto.randomUUIDv4
    }).pipe(Effect.provide(BrowserCryptoLayer)),
  )
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
        const config = await Effect.runPromise(GitHubInstallStartConfig)

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
          installUrl: config.installUrl,
          createIntent: async (intent) => {
            const convex = new ConvexHttpClient(config.convexUrl)
            convex.setAuth(accessToken!)
            await convex.mutation(createGitHubConnectionIntent, intent)
          },
        })
      },
    },
  },
})
