import { createFileRoute } from '@tanstack/react-router'
import { makeFunctionReference } from 'convex/server'
import * as Cloudflare from 'alchemy/Cloudflare/Bridge'
import { Config, Effect, Schema } from 'effect'
import * as HttpBody from 'effect/http/HttpBody'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import { convexMutation } from '@patchplane/plugins/convex/http-client'
import { getSourceControlWorker } from '@/env'
import { createGitHubInstallCallbackResponse } from './-install-flow'

const stageGitHubConnectionInstallation = makeFunctionReference<
  'mutation',
  {
    state: string
    workspaceId: string
    installationId: string
    pkceVerifier: string
  },
  null
>('connectedRepositories:stageGitHubConnectionInstallation')

const consumeGitHubConnectionIntent = makeFunctionReference<
  'mutation',
  { state: string; workspaceId: string },
  {
    workspaceId: string
    actorId: string
    returnPathname?: string
    installationId: string
    pkceVerifier: string
  }
>('connectedRepositories:consumeGitHubConnectionIntent')

const upsertGitHubInstallationRepositories = makeFunctionReference<
  'mutation',
  {
    workspaceId: string
    proof: { issuedAt: number; signature: string }
    account: {
      provider: 'github'
      installationId: string
      accountExternalId: string
      accountLogin: string
      accountType?: string
    }
    repositories: ReadonlyArray<{
      provider: 'github'
      installationId: string
      repositoryExternalId: string
      repositoryOwner: string
      repositoryName: string
      repositoryFullName: string
      private: boolean
      selected: boolean
      permissionsJson?: string
    }>
  },
  ReadonlyArray<unknown>
>('connectedRepositories:upsertGitHubInstallationRepositories')

class SourceControlWorkerSyncError extends Schema.TaggedError<SourceControlWorkerSyncError>()(
  'SourceControlWorkerSyncError',
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

const syncInstallationResponseSchema = Schema.Struct({
  account: Schema.Struct({
    provider: Schema.Literal('github'),
    installationId: Schema.String,
    accountExternalId: Schema.String,
    accountLogin: Schema.String,
    accountType: Schema.optional(Schema.String),
  }),
  proof: Schema.Struct({
    issuedAt: Schema.Finite,
    signature: Schema.String,
  }),
  repositories: Schema.Array(
    Schema.Struct({
      provider: Schema.Literal('github'),
      installationId: Schema.String,
      repositoryExternalId: Schema.String,
      repositoryOwner: Schema.String,
      repositoryName: Schema.String,
      repositoryFullName: Schema.String,
      private: Schema.Boolean,
      selected: Schema.Boolean,
      permissionsJson: Schema.optional(Schema.String),
    }),
  ),
})

const configuredGitHubOAuth = Config.all({
  clientId: Config.NonEmptyString('GITHUB_CLIENT_ID'),
  callbackUrl: Config.NonEmptyString('PATCHPLANE_GITHUB_OAUTH_CALLBACK_URL'),
  apiBaseUrl: Config.URL('GITHUB_BASE_URL').pipe(
    Config.withDefault(new URL('https://api.github.com')),
  ),
})

function githubWebOrigin(apiBaseUrl: URL) {
  return apiBaseUrl.hostname === 'api.github.com'
    ? 'https://github.com'
    : apiBaseUrl.origin
}

const configuredConvexUrl = Config.NonEmptyString('CONVEX_URL').pipe(
  Config.orElse(() => Config.NonEmptyString('VITE_CONVEX_URL')),
  Config.map((value) => value.replace(/\/$/, '')),
)

const handleGitHubInstallCallback = Effect.fn('GitHubInstall.callback')(
  function* (request: Request) {
    const getAuth = yield* Effect.tryPromise({
      try: async () => {
        const authkit = await import('@workos/authkit-tanstack-react-start')
        return authkit.getAuth
      },
      catch: (cause) =>
        new SourceControlWorkerSyncError({
          message: 'WorkOS authentication adapter is unavailable',
          cause,
        }),
    })
    const auth = yield* Effect.tryPromise({
      try: () => getAuth(),
      catch: (cause) =>
        new SourceControlWorkerSyncError({
          message: 'WorkOS authentication could not be loaded',
          cause,
        }),
    })
    const organizationId =
      'organizationId' in auth ? auth.organizationId : undefined
    const accessToken = 'accessToken' in auth ? auth.accessToken : undefined
    const convexError = (cause: unknown) =>
      new SourceControlWorkerSyncError({
        message: `Convex GitHub installation operation failed: ${String(cause)}`,
        cause,
      })
    const { convexUrl, githubOAuth, pkce } = yield* Effect.all({
      convexUrl: configuredConvexUrl,
      githubOAuth: configuredGitHubOAuth,
      pkce: createPkcePair(),
    })
    return yield* createGitHubInstallCallbackResponse<
      SourceControlWorkerSyncError,
      never
    >({
      auth: {
        hasUser: Boolean(auth.user),
        organizationId,
        accessToken,
      },
      requestUrl: request.url,
      stageInstallation: (authenticated, input) =>
        convexMutation({
          url: convexUrl,
          auth: authenticated.accessToken,
          reference: stageGitHubConnectionInstallation,
          args: { ...input, pkceVerifier: pkce.verifier },
          catch: convexError,
        }).pipe(
          Effect.mapError(convexError),
          Effect.map(() => {
            const authorizationUrl = new URL(
              '/login/oauth/authorize',
              githubWebOrigin(githubOAuth.apiBaseUrl),
            )
            authorizationUrl.searchParams.set('client_id', githubOAuth.clientId)
            authorizationUrl.searchParams.set(
              'redirect_uri',
              githubOAuth.callbackUrl,
            )
            authorizationUrl.searchParams.set('state', input.state)
            authorizationUrl.searchParams.set('code_challenge', pkce.challenge)
            authorizationUrl.searchParams.set('code_challenge_method', 'S256')
            return { authorizationUrl: authorizationUrl.toString() }
          }),
        ),
      consumeIntent: (authenticated, input) =>
        convexMutation({
          url: convexUrl,
          auth: authenticated.accessToken,
          reference: consumeGitHubConnectionIntent,
          args: input,
          catch: convexError,
        }).pipe(Effect.mapError(convexError)),
      syncInstallation: (authenticated, input) =>
        Effect.gen(function* () {
          const { account, proof, repositories } =
            yield* syncGitHubInstallation(input)
          yield* convexMutation({
            url: convexUrl,
            auth: authenticated.accessToken,
            reference: upsertGitHubInstallationRepositories,
            args: {
              workspaceId: input.workspaceId,
              proof,
              account: {
                provider: 'github',
                installationId: account.installationId,
                accountExternalId: account.accountExternalId,
                accountLogin: account.accountLogin,
                ...(account.accountType === undefined
                  ? {}
                  : { accountType: account.accountType }),
              },
              repositories: repositories.map((repository) => ({
                provider: 'github' as const,
                installationId: repository.installationId,
                repositoryExternalId: repository.repositoryExternalId,
                repositoryOwner: repository.repositoryOwner,
                repositoryName: repository.repositoryName,
                repositoryFullName: repository.repositoryFullName,
                private: repository.private,
                selected: repository.selected,
                ...(repository.permissionsJson === undefined
                  ? {}
                  : { permissionsJson: repository.permissionsJson }),
              })),
            },
            catch: convexError,
          }).pipe(Effect.mapError(convexError))
        }),
    })
  },
)

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

const createPkcePair = Effect.fnUntraced(function* () {
  const verifierBytes = yield* Effect.sync(() =>
    crypto.getRandomValues(new Uint8Array(48)),
  )
  const verifier = base64Url(verifierBytes)
  const challengeBytes = yield* Effect.tryPromise({
    try: () =>
      crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
    catch: (cause) =>
      new SourceControlWorkerSyncError({
        message: `Failed to create GitHub PKCE challenge: ${String(cause)}`,
      }),
  })
  return {
    verifier,
    challenge: base64Url(new Uint8Array(challengeBytes)),
  }
})

const syncGitHubInstallation = Effect.fnUntraced(function* (input: {
  readonly installationId: string
  readonly workspaceId: string
  readonly authorizationCode: string
  readonly pkceVerifier: string
}) {
  const fetcher = yield* Effect.tryPromise({
    try: () => getSourceControlWorker(),
    catch: () =>
      new SourceControlWorkerSyncError({
        message: 'Source-control Worker binding is unavailable',
      }),
  })
  const client = Cloudflare.toHttpClient(
    Cloudflare.fromCloudflareFetcher(fetcher),
  )
  return yield* client
    .execute(
      HttpClientRequest.post(
        'https://source-control-worker/internal/github/install/sync',
        {
          headers: { 'content-type': 'application/json' },
          body: HttpBody.text(JSON.stringify(input), 'application/json'),
        },
      ),
    )
    .pipe(
      Effect.flatMap((workerResponse) =>
        workerResponse.status >= 200 && workerResponse.status < 300
          ? workerResponse.json.pipe(
              Effect.mapError(
                (cause) =>
                  new SourceControlWorkerSyncError({
                    message:
                      'Source-control Worker returned an invalid response',
                    cause,
                  }),
              ),
            )
          : Effect.fail(
              new SourceControlWorkerSyncError({
                message: `Source-control worker sync failed: ${workerResponse.status}`,
              }),
            ),
      ),
      Effect.flatMap(
        Schema.decodeUnknownEffect(syncInstallationResponseSchema),
      ),
      Effect.mapError((cause) =>
        cause instanceof SourceControlWorkerSyncError
          ? cause
          : new SourceControlWorkerSyncError({
              message: 'Source-control Worker returned an invalid response',
            }),
      ),
    )
})

export const Route = createFileRoute('/api/github/install/callback')({
  server: {
    handlers: {
      GET: ({ request }: { request: Request }) => {
        if (!import.meta.env.SSR) {
          return new Response('GitHub installation callback is server-only', {
            status: 404,
          })
        }

        return Effect.runPromise(handleGitHubInstallCallback(request), {
          signal: request.signal,
        })
      },
    },
  },
})
