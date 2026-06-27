import { createFileRoute } from '@tanstack/react-router'
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import * as Cloudflare from 'alchemy/Cloudflare/Bridge'
import { Effect, Schema } from 'effect'
import * as HttpBody from 'effect/unstable/http/HttpBody'
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest'
import { env } from '@/env'
import { createGitHubInstallCallbackResponse } from './-install-flow'

const consumeGitHubConnectionIntent = makeFunctionReference<
  'mutation',
  { state: string; workspaceId: string },
  { workspaceId: string; actorId: string; returnPathname?: string }
>('connectedRepositories:consumeGitHubConnectionIntent')

const upsertGitHubInstallationRepositories = makeFunctionReference<
  'mutation',
  {
    workspaceId: string
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

class SourceControlWorkerSyncError extends Schema.ErrorClass<SourceControlWorkerSyncError>('SourceControlWorkerSyncError')({
  message: Schema.String,
}) {}

const syncInstallationResponseSchema = Schema.Struct({
  account: Schema.Struct({
    provider: Schema.Literal('github'),
    installationId: Schema.String,
    accountExternalId: Schema.String,
    accountLogin: Schema.String,
    accountType: Schema.optional(Schema.String),
  }),
  repositories: Schema.Array(Schema.Struct({
    provider: Schema.Literal('github'),
    installationId: Schema.String,
    repositoryExternalId: Schema.String,
    repositoryOwner: Schema.String,
    repositoryName: Schema.String,
    repositoryFullName: Schema.String,
    private: Schema.Boolean,
    selected: Schema.Boolean,
    permissionsJson: Schema.optional(Schema.String),
  })),
})

function configuredConvexUrl() {
  const value = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL
  if (value === undefined || value.trim().length === 0) {
    throw new Error('CONVEX_URL or VITE_CONVEX_URL is required')
  }
  return value.replace(/\/$/, '')
}

function internalWorkerToken() {
  const value = process.env.PATCHPLANE_INTERNAL_WORKER_TOKEN?.trim()
  if (!value) {
    throw new Error('PATCHPLANE_INTERNAL_WORKER_TOKEN is required')
  }
  return value
}

async function syncGitHubInstallation(input: {
  readonly installationId: string
  readonly workspaceId: string
}) {
  const client = Cloudflare.toHttpClient(
    Cloudflare.fromCloudflareFetcher(env.SOURCE_CONTROL_WORKER),
  )

  const { patchPlaneRuntime } = await import('@/effect/runtime')
  const response = await patchPlaneRuntime.runPromise(
    client.execute(
      HttpClientRequest.post('https://source-control-worker/internal/github/install/sync', {
        headers: {
          authorization: `Bearer ${internalWorkerToken()}`,
          'content-type': 'application/json',
        },
        body: HttpBody.text(JSON.stringify(input), 'application/json'),
      }),
    ).pipe(
      Effect.flatMap((workerResponse) =>
        workerResponse.status >= 200 && workerResponse.status < 300
          ? workerResponse.json
          : Effect.fail(new SourceControlWorkerSyncError({ message: `Source-control worker sync failed: ${workerResponse.status}` })),
      ),
      Effect.flatMap(Schema.decodeUnknownEffect(syncInstallationResponseSchema)),
    ),
  )

  return response
}

export const Route = createFileRoute('/api/github/install/callback')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        if (!import.meta.env.SSR) {
          return new Response('GitHub installation callback is server-only', { status: 404 })
        }

        const { getAuth } = await import('@workos/authkit-tanstack-react-start')
        const auth = await getAuth()
        const organizationId = 'organizationId' in auth ? auth.organizationId : undefined
        const accessToken = 'accessToken' in auth ? auth.accessToken : undefined
        const convex = new ConvexHttpClient(configuredConvexUrl())
        if (accessToken) {
          convex.setAuth(accessToken)
        }

        return createGitHubInstallCallbackResponse({
          auth: {
            hasUser: Boolean(auth.user),
            organizationId,
            accessToken,
          },
          requestUrl: request.url,
          consumeIntent: (input) =>
            convex.mutation(consumeGitHubConnectionIntent, input),
          syncInstallation: async ({ installationId, workspaceId }) => {
            const { account, repositories } = await syncGitHubInstallation({ installationId, workspaceId })
            await convex.mutation(upsertGitHubInstallationRepositories, {
              workspaceId,
              account: {
                provider: 'github',
                installationId: account.installationId,
                accountExternalId: account.accountExternalId,
                accountLogin: account.accountLogin,
                ...(account.accountType === undefined ? {} : { accountType: account.accountType }),
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
                ...(repository.permissionsJson === undefined ? {} : { permissionsJson: repository.permissionsJson }),
              })),
            })
          },
        })
      },
    },
  },
})
