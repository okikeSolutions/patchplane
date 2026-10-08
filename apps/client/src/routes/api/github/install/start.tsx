import { layer as BrowserCryptoLayer } from '@effect/platform-browser/BrowserCrypto'
import { createFileRoute } from '@tanstack/react-router'
import { Config, Crypto, Effect, Schema } from 'effect'
import { makeFunctionReference } from 'convex/server'
import { convexMutation } from '@patchplane/plugins/convex/http-client'
import { createGitHubInstallStartResponse } from './-install-flow'

class GitHubInstallStartError extends Schema.TaggedError<GitHubInstallStartError>()(
  'GitHubInstallStartError',
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

const createGitHubConnectionIntent = makeFunctionReference<
  'mutation',
  {
    state: string
    workspaceId: string
    returnPathname?: string
  },
  { state: string }
>('connectedRepositories:createGitHubConnectionIntent')

const GitHubInstallStartConfig = Config.all({
  convexUrl: Config.NonEmptyString('CONVEX_URL').pipe(
    Config.orElse(() => Config.NonEmptyString('VITE_CONVEX_URL')),
    Config.map((value) => value.replace(/\/$/, '')),
  ),
  installUrl: Config.NonEmptyString('PATCHPLANE_GITHUB_APP_INSTALL_URL').pipe(
    Config.orElse(() =>
      Config.all({
        slug: Config.NonEmptyString('PATCHPLANE_GITHUB_APP_SLUG'),
        apiBaseUrl: Config.URL('GITHUB_BASE_URL').pipe(
          Config.withDefault(new URL('https://api.github.com')),
        ),
      }).pipe(
        Config.map(({ slug, apiBaseUrl }) => {
          const webOrigin =
            apiBaseUrl.hostname === 'api.github.com'
              ? 'https://github.com'
              : apiBaseUrl.origin
          return `${webOrigin}/apps/${encodeURIComponent(slug)}/installations/new`
        }),
      ),
    ),
  ),
})

const randomInstallState = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto
  return yield* crypto.randomUUIDv4
})

const handleGitHubInstallStart = Effect.fn('GitHubInstall.start')(function* (
  request: Request,
) {
  const getAuth = yield* Effect.tryPromise({
    try: async () => {
      const authkit = await import('@workos/authkit-tanstack-react-start')
      return authkit.getAuth
    },
    catch: (cause) =>
      new GitHubInstallStartError({
        message: 'WorkOS authentication adapter is unavailable',
        cause,
      }),
  })
  const auth = yield* Effect.tryPromise({
    try: () => getAuth(),
    catch: (cause) =>
      new GitHubInstallStartError({
        message: 'WorkOS authentication could not be loaded',
        cause,
      }),
  })
  const organizationId =
    'organizationId' in auth ? auth.organizationId : undefined
  const accessToken = 'accessToken' in auth ? auth.accessToken : undefined
  const [state, config] = yield* Effect.all([
    randomInstallState,
    GitHubInstallStartConfig,
  ])
  return yield* createGitHubInstallStartResponse({
    auth: {
      hasUser: Boolean(auth.user),
      organizationId,
      accessToken,
    },
    requestUrl: request.url,
    state,
    installUrl: config.installUrl,
    createIntent: (authenticated, intent) =>
      convexMutation({
        url: config.convexUrl,
        auth: authenticated.accessToken,
        reference: createGitHubConnectionIntent,
        args: intent,
        catch: (cause) =>
          new GitHubInstallStartError({
            message: 'Failed to create GitHub connection intent',
            cause,
          }),
      }),
  })
})

export const Route = createFileRoute('/api/github/install/start')({
  server: {
    handlers: {
      GET: ({ request }: { request: Request }) => {
        if (!import.meta.env.SSR) {
          return new Response('GitHub installation start is server-only', {
            status: 404,
          })
        }

        return Effect.runPromise(
          handleGitHubInstallStart(request).pipe(
            Effect.provide(BrowserCryptoLayer),
          ),
          { signal: request.signal },
        )
      },
    },
  },
})
