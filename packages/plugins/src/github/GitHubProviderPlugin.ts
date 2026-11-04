import { Effect, Layer, Redacted } from 'effect'
import { Octokit } from 'octokit'
import { GitHubError, SourceControlError } from '@patchplane/domain/errors'
import {
  decodeGitHubRepositoryRef,
  decodeGitHubWebhookVerification,
} from '@patchplane/domain/github'
import { GitHubWebhookService } from '@patchplane/core/services/github-webhook-service'
import {
  type FetchImmutableComparisonInput,
  SourceControlService,
} from '@patchplane/core/services/source-control-service'
import { GitHubConfig } from './GitHubConfig'
import { boundedGitHubFetch } from './github-bounded-fetch'
import { makeGitHubApp } from './github-app'
import { parseGitHubInstallationId } from './github-installation'
import { githubProviderDeadlineSignal } from './github-provider-deadline'

function toGitHubRepositoryTokenScope(input: {
  readonly name: string
  readonly repositoryExternalId?: string | undefined
}) {
  if (input.repositoryExternalId === undefined) {
    return Effect.succeed({ repositories: [input.name] })
  }

  const repositoryId = Number(input.repositoryExternalId)
  if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0) {
    return Effect.fail(
      new SourceControlError({
        operation: 'GitHubProviderPlugin.parseGitHubRepositoryId',
        message: 'GitHub clone credentials received an invalid repository id',
        cause: input,
      }),
    )
  }

  return Effect.succeed({ repository_ids: [repositoryId] })
}

class ImmutableComparisonResponseError extends Error {
  constructor(
    readonly operation: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
  }
}

function rawInstallationToken(value: unknown) {
  return typeof value === 'object' &&
    value !== null &&
    'token' in value &&
    typeof value.token === 'string' &&
    value.token.length > 0
    ? value.token
    : undefined
}

function rawOAuthAccessToken(value: unknown) {
  return typeof value === 'object' &&
    value !== null &&
    'access_token' in value &&
    typeof value.access_token === 'string' &&
    value.access_token.length > 0
    ? value.access_token
    : undefined
}

function decodeTemporaryOAuthAccessToken(value: unknown) {
  const accessToken = rawOAuthAccessToken(value)
  if (
    typeof value !== 'object' ||
    value === null ||
    ('error' in value && value.error !== undefined) ||
    accessToken === undefined ||
    !('expires_in' in value) ||
    !Number.isSafeInteger(value.expires_in) ||
    Number(value.expires_in) <= 0 ||
    Number(value.expires_in) > 8 * 60 * 60 ||
    !('refresh_token' in value) ||
    typeof value.refresh_token !== 'string' ||
    value.refresh_token.length === 0 ||
    !('refresh_token_expires_in' in value) ||
    !Number.isSafeInteger(value.refresh_token_expires_in) ||
    Number(value.refresh_token_expires_in) <= 0 ||
    Number(value.refresh_token_expires_in) > 6 * 31 * 24 * 60 * 60
  ) {
    throw new Error('GitHub returned an invalid user access token')
  }
  return accessToken
}

function publicationMarker(idempotencyKey: string) {
  return `<!-- patchplane-publication:${encodeURIComponent(idempotencyKey)} -->`
}

function decodeInstallationToken(
  value: unknown,
  options: {
    readonly permission: 'contents' | 'metadata'
    readonly repositorySelection?: 'selected'
    readonly repository?: {
      readonly id?: number | undefined
      readonly name: string
    }
  },
) {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('token' in value) ||
    typeof value.token !== 'string' ||
    value.token.length === 0 ||
    !('expires_at' in value) ||
    typeof value.expires_at !== 'string' ||
    !('permissions' in value) ||
    typeof value.permissions !== 'object' ||
    value.permissions === null ||
    !(options.permission in value.permissions) ||
    value.permissions[options.permission as keyof typeof value.permissions] !==
      'read' ||
    (options.repositorySelection !== undefined &&
      (!('repository_selection' in value) ||
        value.repository_selection !== options.repositorySelection))
  ) {
    throw new Error('GitHub returned invalid installation token capability')
  }
  const permissions = Object.entries(value.permissions)
  const allowedPermissions = new Set(['metadata', options.permission])
  if (
    permissions.some(
      ([name, level]) => !allowedPermissions.has(name) || level !== 'read',
    )
  ) {
    throw new Error('GitHub returned over-privileged installation token')
  }
  if (options.repository !== undefined) {
    if (
      !('repositories' in value) ||
      !Array.isArray(value.repositories) ||
      value.repositories.length !== 1
    ) {
      throw new Error(
        'GitHub returned invalid installation token repository scope',
      )
    }
    const repository: unknown = value.repositories[0]
    if (
      typeof repository !== 'object' ||
      repository === null ||
      !('name' in repository) ||
      repository.name !== options.repository.name ||
      (options.repository.id !== undefined &&
        (!('id' in repository) || repository.id !== options.repository.id))
    ) {
      throw new Error(
        'GitHub returned invalid installation token repository scope',
      )
    }
  }
  const expiresAt = Date.parse(value.expires_at)
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now() ||
    expiresAt > Date.now() + 65 * 60_000
  ) {
    throw new Error('GitHub returned invalid installation token expiry')
  }
  return value.token
}

function decodePublicationInstallationToken(
  value: unknown,
  input: {
    readonly permission: 'issues' | 'checks' | 'pull_requests'
    readonly name: string
  },
) {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('token' in value) ||
    typeof value.token !== 'string' ||
    value.token.length === 0 ||
    !('expires_at' in value) ||
    typeof value.expires_at !== 'string' ||
    !('repository_selection' in value) ||
    value.repository_selection !== 'selected' ||
    !('repositories' in value) ||
    !Array.isArray(value.repositories) ||
    value.repositories.length !== 1 ||
    typeof value.repositories[0] !== 'object' ||
    value.repositories[0] === null ||
    !('name' in value.repositories[0]) ||
    value.repositories[0].name !== input.name ||
    !('permissions' in value) ||
    typeof value.permissions !== 'object' ||
    value.permissions === null
  ) {
    throw new Error('GitHub returned invalid publication token scope')
  }
  const permissions = Object.entries(value.permissions)
  const expected = new Map([
    ['metadata', 'read'],
    [input.permission, 'write'],
  ])
  if (
    permissions.length !== expected.size ||
    permissions.some(([name, level]) => expected.get(name) !== level)
  ) {
    throw new Error('GitHub returned invalid publication token permissions')
  }
  const expiresAt = Date.parse(value.expires_at)
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now() ||
    expiresAt > Date.now() + 65 * 60_000
  ) {
    throw new Error('GitHub returned invalid publication token expiry')
  }
  return value.token
}

function cancelResponseBody(response: Response) {
  try {
    void response.body?.cancel().catch(() => undefined)
  } catch {
    // Cancellation is best-effort and must not block a release finalizer.
  }
}

function githubRepositoryInventoryError(cause: unknown) {
  return new SourceControlError({
    operation: 'listInstallationRepositories.github',
    message: 'GitHub failed to list installation repositories',
    cause,
  })
}

const sourceControlLayer = Layer.effect(
  SourceControlService,
  Effect.gen(function* () {
    const config = yield* GitHubConfig
    const { app, baseUrl } = makeGitHubApp(config)

    yield* Effect.logInfo('Initialized GitHub source-control provider plugin', {
      appId: config.appId,
      ...(baseUrl === undefined ? {} : { baseUrl }),
    })

    const configuredNumericAppId = Number(config.appId)

    const revokePublicationToken = (token: string) =>
      Effect.tryPromise({
        try: async (signal) => {
          const apiBaseUrl = (baseUrl ?? 'https://api.github.com').replace(
            /\/$/,
            '',
          )
          const response = await globalThis.fetch(
            `${apiBaseUrl}/installation/token`,
            {
              method: 'DELETE',
              headers: {
                accept: 'application/vnd.github+json',
                authorization: `Bearer ${token}`,
                'user-agent': 'patchplane',
                'x-github-api-version': '2022-11-28',
              },
              redirect: 'manual',
              signal: githubProviderDeadlineSignal(signal, 5_000),
            },
          )
          cancelResponseBody(response)
          if (!response.ok) {
            throw Object.assign(
              new Error('GitHub publication token revocation failed'),
              { status: response.status },
            )
          }
        },
        catch: (cause) =>
          new SourceControlError({
            operation: 'publicationToken.revoke',
            message: 'GitHub publication token revocation failed',
            cause: {
              errorType: cause instanceof Error ? cause.name : typeof cause,
              ...(cause instanceof Error
                ? {
                    errorDetail: cause.message
                      .replace(/https?:\/\/\S+/g, '[url]')
                      .slice(0, 256),
                  }
                : {}),
              ...(typeof cause === 'object' &&
              cause !== null &&
              typeof Reflect.get(cause, 'status') === 'number'
                ? { status: Reflect.get(cause, 'status') as number }
                : {}),
            },
          }),
      }).pipe(
        Effect.timeoutOrElse({
          duration: 5_000,
          orElse: () =>
            Effect.fail(
              new SourceControlError({
                operation: 'publicationToken.revoke',
                message: 'GitHub publication token revocation timed out',
                cause: { timeoutMilliseconds: 5_000 },
              }),
            ),
        }),
      )

    const withPublicationOctokit = <A, E>(input: {
      readonly installationId: number
      readonly name: string
      readonly permission: 'issues' | 'checks' | 'pull_requests'
      readonly use: (octokit: Octokit) => Effect.Effect<A, E>
    }) =>
      Effect.acquireUseRelease(
        Effect.tryPromise({
          try: async (signal) => {
            const response = await app.octokit.request(
              'POST /app/installations/{installation_id}/access_tokens',
              {
                installation_id: input.installationId,
                repositories: [input.name],
                permissions: { [input.permission]: 'write' },
                request: {
                  signal: githubProviderDeadlineSignal(signal),
                  redirect: 'manual',
                  retries: 0,
                },
              },
            )
            return response.data
          },
          catch: (cause) =>
            new SourceControlError({
              operation: 'publicationToken.acquire',
              message: 'GitHub failed to create scoped publication credentials',
              cause,
            }),
        }),
        (tokenData) =>
          Effect.try({
            try: () =>
              decodePublicationInstallationToken(tokenData, {
                permission: input.permission,
                name: input.name,
              }),
            catch: (cause) =>
              new SourceControlError({
                operation: 'publicationToken.acquire',
                message:
                  'GitHub failed to create scoped publication credentials',
                cause,
              }),
          }).pipe(
            Effect.flatMap((token) =>
              input.use(
                new Octokit({
                  auth: token,
                  ...(baseUrl === undefined ? {} : { baseUrl }),
                  request: { fetch: boundedGitHubFetch(4 * 1_024 * 1_024) },
                }),
              ),
            ),
          ),
        (tokenData) => {
          const token = rawInstallationToken(tokenData)
          return token === undefined
            ? Effect.void
            : revokePublicationToken(token)
        },
      )

    const verifyRepositoryAccess = Effect.fn(
      'GitHubProviderPlugin.verifyRepositoryAccess',
    )(function* (input: {
      readonly provider: string
      readonly installationId?: string
      readonly owner: string
      readonly name: string
    }) {
      const installationId = yield* parseGitHubInstallationId(input)
      const repository = yield* Effect.acquireUseRelease(
        Effect.tryPromise({
          try: async (signal) => {
            const response = await app.octokit.request(
              'POST /app/installations/{installation_id}/access_tokens',
              {
                installation_id: installationId,
                repositories: [input.name],
                permissions: { metadata: 'read' },
                request: {
                  signal: githubProviderDeadlineSignal(signal),
                  redirect: 'manual',
                  retries: 0,
                },
              },
            )
            return response.data
          },
          catch: (cause) =>
            new SourceControlError({
              operation: 'verifyRepositoryAccess.acquire',
              message:
                'GitHub failed to create scoped repository verification credentials',
              cause,
            }),
        }),
        (tokenData) =>
          Effect.tryPromise({
            try: async (signal) => {
              const token = decodeInstallationToken(tokenData, {
                permission: 'metadata',
                repositorySelection: 'selected',
                repository: { name: input.name },
              })
              const octokit = new Octokit({
                auth: token,
                ...(baseUrl === undefined ? {} : { baseUrl }),
                request: { fetch: boundedGitHubFetch(4 * 1_024 * 1_024) },
              })
              const response = await octokit.request(
                'GET /installation/repositories',
                {
                  per_page: 100,
                  page: 1,
                  request: { signal: githubProviderDeadlineSignal(signal) },
                },
              )
              if (
                response.data.total_count !== 1 ||
                response.data.repositories.length !== 1
              ) {
                throw new Error(
                  'GitHub scoped repository inventory was not exact',
                )
              }
              const scopedRepository = response.data.repositories[0]
              if (
                scopedRepository?.full_name.toLowerCase() !==
                `${input.owner}/${input.name}`.toLowerCase()
              ) {
                throw new Error(
                  'Repository is not accessible to the GitHub installation',
                )
              }
              return scopedRepository
            },
            catch: (cause) =>
              new SourceControlError({
                operation: 'verifyRepositoryAccess.github',
                message: 'GitHub failed to verify repository access',
                cause,
              }),
          }),
        (tokenData) => {
          const token = rawInstallationToken(tokenData)
          if (token === undefined) return Effect.void
          return Effect.tryPromise({
            try: async (signal) => {
              const apiBaseUrl = (baseUrl ?? 'https://api.github.com').replace(
                /\/$/,
                '',
              )
              const response = await globalThis.fetch(
                `${apiBaseUrl}/installation/token`,
                {
                  method: 'DELETE',
                  headers: {
                    accept: 'application/vnd.github+json',
                    authorization: `Bearer ${token}`,
                    'user-agent': 'patchplane',
                    'x-github-api-version': '2022-11-28',
                  },
                  redirect: 'manual',
                  signal: githubProviderDeadlineSignal(signal, 5_000),
                },
              )
              cancelResponseBody(response)
              if (!response.ok) {
                throw new Error(
                  'GitHub repository verification token revocation failed',
                )
              }
            },
            catch: (cause) =>
              new SourceControlError({
                operation: 'verifyRepositoryAccess.revoke',
                message:
                  'GitHub repository verification token revocation failed',
                cause,
              }),
          })
        },
      )

      const decoded = yield* decodeGitHubRepositoryRef({
        provider: 'github',
        installationId,
        owner: repository.owner.login,
        name: repository.name,
        fullName: repository.full_name,
        repositoryExternalId: String(repository.id),
        private: repository.private,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new SourceControlError({
              operation: 'verifyRepositoryAccess.decode',
              message: 'GitHub returned an invalid repository reference',
              cause,
            }),
        ),
      )

      return {
        provider: decoded.provider,
        installationId: String(decoded.installationId),
        owner: decoded.owner,
        name: decoded.name,
        fullName: decoded.fullName,
        repositoryExternalId: decoded.repositoryExternalId,
        private: decoded.private,
      }
    })

    const getInstallationAccount = Effect.fn(
      'GitHubProviderPlugin.getInstallationAccount',
    )(function* (input: {
      readonly provider: string
      readonly installationId?: string
    }) {
      const installationId = yield* parseGitHubInstallationId(input)
      const installation = yield* Effect.tryPromise({
        try: async (signal) => {
          const result = await app.octokit.request(
            'GET /app/installations/{installation_id}',
            {
              installation_id: installationId,
              request: { signal },
            },
          )
          return result.data
        },
        catch: (cause) =>
          new SourceControlError({
            operation: 'getInstallationAccount.github',
            message: 'GitHub failed to get installation account',
            cause,
          }),
      }).pipe(
        Effect.timeoutOrElse({
          duration: 15_000,
          orElse: () =>
            Effect.fail(
              new SourceControlError({
                operation: 'getInstallationAccount.github',
                message: 'GitHub installation account request timed out',
                cause: { timeoutMilliseconds: 15_000 },
              }),
            ),
        }),
      )

      const account = installation.account
      const accountLogin =
        account !== null && 'login' in account ? account.login : account?.slug
      if (
        account === null ||
        !Number.isSafeInteger(account.id) ||
        account.id <= 0 ||
        typeof accountLogin !== 'string' ||
        accountLogin.length === 0
      ) {
        return yield* new SourceControlError({
          operation: 'getInstallationAccount.decode',
          message: 'GitHub installation has invalid account identity',
          cause: installation,
        })
      }

      return {
        provider: 'github',
        installationId: String(installationId),
        accountExternalId: String(account.id),
        accountLogin,
        accountType: 'type' in account ? account.type : 'Enterprise',
      }
    })

    const verifyGitHubInstallationOwnership = Effect.fn(
      'GitHubProviderPlugin.verifyGitHubInstallationOwnership',
    )(function* (input: {
      readonly provider: 'github'
      readonly installationId: string
      readonly authorizationCode: string
      readonly pkceVerifier: string
    }) {
      const installationId = yield* parseGitHubInstallationId(input)
      const configuredApiUrl =
        baseUrl === undefined ? undefined : new URL(baseUrl)
      const githubWebOrigin =
        configuredApiUrl === undefined ||
        configuredApiUrl.hostname === 'api.github.com'
          ? 'https://github.com'
          : configuredApiUrl.origin

      const acquireUserToken = Effect.tryPromise({
        try: async (signal) => {
          const tokenResponse = await boundedGitHubFetch(16 * 1_024)(
            `${githubWebOrigin}/login/oauth/access_token`,
            {
              method: 'POST',
              headers: {
                accept: 'application/json',
                'content-type': 'application/x-www-form-urlencoded',
                'user-agent': 'patchplane',
              },
              body: new URLSearchParams({
                client_id: config.clientId,
                client_secret: Redacted.value(config.clientSecret),
                code: input.authorizationCode,
                code_verifier: input.pkceVerifier,
                redirect_uri: config.oauthCallbackUrl,
              }),
              redirect: 'manual',
              signal: githubProviderDeadlineSignal(signal),
            },
          )
          if (!tokenResponse.ok) {
            throw new Error('GitHub user authorization exchange failed')
          }
          return (await tokenResponse.json()) as unknown
        },
        catch: (cause) =>
          new SourceControlError({
            operation: 'verifyGitHubInstallationOwnership.exchange',
            message: 'GitHub user authorization exchange failed',
            cause: {
              errorType: cause instanceof Error ? cause.name : typeof cause,
            },
          }),
      }).pipe(
        Effect.timeoutOrElse({
          duration: 15_000,
          orElse: () =>
            Effect.fail(
              new SourceControlError({
                operation: 'verifyGitHubInstallationOwnership.exchange',
                message: 'GitHub user authorization exchange timed out',
                cause: { timeoutMilliseconds: 15_000 },
              }),
            ),
        }),
      )

      const verifyOwnership = (token: string) =>
        Effect.tryPromise({
          try: async (signal) => {
            const userOctokit = new Octokit({
              auth: token,
              ...(baseUrl === undefined ? {} : { baseUrl }),
              request: { fetch: boundedGitHubFetch(4 * 1_024 * 1_024) },
            })
            const authenticatedUser = await userOctokit.request('GET /user', {
              request: { signal },
            })

            let requestedInstallation:
              | Awaited<
                  ReturnType<
                    typeof userOctokit.rest.apps.listInstallationsForAuthenticatedUser
                  >
                >['data']['installations'][number]
              | undefined
            for (let page = 1; page <= 10; page += 1) {
              const response =
                await userOctokit.rest.apps.listInstallationsForAuthenticatedUser(
                  {
                    per_page: 100,
                    page,
                    request: { signal },
                  },
                )
              requestedInstallation = response.data.installations.find(
                (installation) => installation.id === installationId,
              )
              if (
                requestedInstallation !== undefined ||
                response.data.installations.length < 100
              ) {
                break
              }
            }
            if (requestedInstallation === undefined) {
              throw new Error(
                'GitHub user cannot access the requested installation',
              )
            }

            const account = requestedInstallation.account
            if (
              account === null ||
              !Number.isSafeInteger(account.id) ||
              account.id <= 0 ||
              !('type' in account) ||
              typeof account.type !== 'string'
            ) {
              throw new Error('GitHub installation account is invalid')
            }
            if (account.type === 'User') {
              if (authenticatedUser.data.id !== account.id) {
                throw new Error(
                  'GitHub user does not own the installation account',
                )
              }
              return
            }
            if (
              account.type !== 'Organization' ||
              !('login' in account) ||
              typeof account.login !== 'string' ||
              account.login.length === 0
            ) {
              throw new Error(
                'GitHub installation account type cannot be verified',
              )
            }

            const membership = await userOctokit.request(
              'GET /user/memberships/orgs/{org}',
              {
                org: account.login,
                request: { signal },
              },
            )
            if (
              membership.data.state !== 'active' ||
              membership.data.role !== 'admin'
            ) {
              throw new Error(
                'GitHub user is not an active administrator of the installation organization',
              )
            }
          },
          catch: (cause) =>
            new SourceControlError({
              operation: 'verifyGitHubInstallationOwnership.verify',
              message:
                'GitHub user does not control the requested installation',
              cause: {
                errorType: cause instanceof Error ? cause.name : typeof cause,
              },
            }),
        })

      const revokeUserToken = (token: string) =>
        Effect.tryPromise({
          try: async (signal) => {
            const apiBaseUrl = (baseUrl ?? 'https://api.github.com').replace(
              /\/$/,
              '',
            )
            const response = await boundedGitHubFetch(1_024)(
              `${apiBaseUrl}/applications/${encodeURIComponent(config.clientId)}/token`,
              {
                method: 'DELETE',
                headers: {
                  accept: 'application/vnd.github+json',
                  authorization: `Basic ${btoa(`${config.clientId}:${Redacted.value(config.clientSecret)}`)}`,
                  'content-type': 'application/json',
                  'user-agent': 'patchplane',
                  'x-github-api-version': '2022-11-28',
                },
                body: JSON.stringify({ access_token: token }),
                redirect: 'manual',
                signal: githubProviderDeadlineSignal(signal, 5_000),
              },
            )
            if (!response.ok) {
              throw new Error('GitHub temporary user token revocation failed')
            }
          },
          catch: (cause) =>
            new SourceControlError({
              operation: 'verifyGitHubInstallationOwnership.revoke',
              message: 'GitHub temporary user token revocation failed',
              cause: {
                errorType: cause instanceof Error ? cause.name : typeof cause,
              },
            }),
        }).pipe(
          Effect.timeoutOrElse({
            duration: 5_000,
            orElse: () =>
              Effect.fail(
                new SourceControlError({
                  operation: 'verifyGitHubInstallationOwnership.revoke',
                  message: 'GitHub temporary user token revocation timed out',
                  cause: { timeoutMilliseconds: 5_000 },
                }),
              ),
          }),
        )

      yield* Effect.acquireUseRelease(
        acquireUserToken,
        (tokenData) =>
          Effect.try({
            try: () => decodeTemporaryOAuthAccessToken(tokenData),
            catch: (cause) =>
              new SourceControlError({
                operation: 'verifyGitHubInstallationOwnership.exchange',
                message: 'GitHub returned an invalid user access token',
                cause: {
                  errorType: cause instanceof Error ? cause.name : typeof cause,
                },
              }),
          }).pipe(
            Effect.flatMap(verifyOwnership),
            Effect.timeoutOrElse({
              duration: 20_000,
              orElse: () =>
                Effect.fail(
                  new SourceControlError({
                    operation: 'verifyGitHubInstallationOwnership.verify',
                    message:
                      'GitHub installation ownership verification timed out',
                    cause: { timeoutMilliseconds: 20_000 },
                  }),
                ),
            }),
          ),
        (tokenData) => {
          const token = rawOAuthAccessToken(tokenData)
          return token === undefined ? Effect.void : revokeUserToken(token)
        },
      )
    })

    const listInstallationRepositories = Effect.fn(
      'GitHubProviderPlugin.listInstallationRepositories',
    )(function* (input: {
      readonly provider: string
      readonly installationId?: string
    }) {
      const installationId = yield* parseGitHubInstallationId(input)
      const acquireInstallationToken = Effect.tryPromise({
        try: async (signal) => {
          const tokenResponse = await app.octokit.request(
            'POST /app/installations/{installation_id}/access_tokens',
            {
              installation_id: installationId,
              permissions: { metadata: 'read' },
              request: {
                signal: githubProviderDeadlineSignal(signal),
                redirect: 'manual',
                retries: 0,
              },
            },
          )
          return tokenResponse.data
        },
        catch: (cause) => githubRepositoryInventoryError(cause),
      }).pipe(
        Effect.timeoutOrElse({
          duration: 15_000,
          orElse: () =>
            Effect.fail(
              githubRepositoryInventoryError({ timeoutMilliseconds: 15_000 }),
            ),
        }),
      )
      const listRepositories = (token: string) =>
        Effect.tryPromise({
          try: async (signal) => {
            const installationOctokit = new Octokit({
              auth: token,
              ...(baseUrl === undefined ? {} : { baseUrl }),
              request: { fetch: boundedGitHubFetch(4 * 1_024 * 1_024) },
            })
            const collectedRepositories = [] as Array<
              Awaited<
                ReturnType<
                  typeof installationOctokit.rest.apps.listReposAccessibleToInstallation
                >
              >['data']['repositories'][number]
            >
            for (let page = 1; page <= 10; page += 1) {
              const response =
                await installationOctokit.rest.apps.listReposAccessibleToInstallation(
                  {
                    per_page: 100,
                    page,
                    request: { signal },
                  },
                )
              if (
                response.data.total_count > 1_000 ||
                collectedRepositories.length +
                  response.data.repositories.length >
                  1_000
              ) {
                throw new Error(
                  'GitHub installation repository inventory exceeds 1000 entries',
                )
              }
              collectedRepositories.push(...response.data.repositories)
              if (response.data.repositories.length < 100) {
                return collectedRepositories
              }
            }
            return collectedRepositories
          },
          catch: (cause) => githubRepositoryInventoryError(cause),
        }).pipe(
          Effect.timeoutOrElse({
            duration: 20_000,
            orElse: () =>
              Effect.fail(
                githubRepositoryInventoryError({
                  timeoutMilliseconds: 20_000,
                }),
              ),
          }),
        )
      const revokeInstallationToken = (token: string) =>
        Effect.tryPromise({
          try: async (signal) => {
            const apiBaseUrl = (baseUrl ?? 'https://api.github.com').replace(
              /\/$/,
              '',
            )
            const response = await globalThis.fetch(
              `${apiBaseUrl}/installation/token`,
              {
                method: 'DELETE',
                headers: {
                  accept: 'application/vnd.github+json',
                  authorization: `Bearer ${token}`,
                  'user-agent': 'patchplane',
                  'x-github-api-version': '2022-11-28',
                },
                redirect: 'manual',
                signal: githubProviderDeadlineSignal(signal, 5_000),
              },
            )
            cancelResponseBody(response)
            if (!response.ok) {
              throw new Error('GitHub installation token revocation failed')
            }
          },
          catch: (cause) => githubRepositoryInventoryError(cause),
        }).pipe(
          Effect.timeoutOrElse({
            duration: 5_000,
            orElse: () =>
              Effect.fail(
                githubRepositoryInventoryError({ timeoutMilliseconds: 5_000 }),
              ),
          }),
        )
      const repositories = yield* Effect.acquireUseRelease(
        acquireInstallationToken,
        (tokenData) =>
          Effect.try({
            try: () =>
              decodeInstallationToken(tokenData, { permission: 'metadata' }),
            catch: (cause) => githubRepositoryInventoryError(cause),
          }).pipe(Effect.flatMap(listRepositories)),
        (tokenData) => {
          const token = rawInstallationToken(tokenData)
          return token === undefined
            ? Effect.void
            : revokeInstallationToken(token)
        },
      )

      return yield* Effect.forEach(repositories, (repository) => {
        if (
          !Number.isSafeInteger(repository.id) ||
          repository.id <= 0 ||
          typeof repository.private !== 'boolean'
        ) {
          return Effect.fail(
            new SourceControlError({
              operation: 'listInstallationRepositories.decode',
              message:
                'GitHub returned incomplete installation repository identity',
              cause: repository,
            }),
          )
        }
        const ownerLogin =
          typeof repository.owner === 'object' &&
          repository.owner !== null &&
          'login' in repository.owner &&
          typeof repository.owner.login === 'string'
            ? repository.owner.login
            : undefined

        return decodeGitHubRepositoryRef({
          provider: 'github',
          installationId,
          owner: ownerLogin,
          name: repository.name,
          fullName: repository.full_name,
          repositoryExternalId: String(repository.id),
          private: repository.private,
        }).pipe(
          Effect.map((decoded) => ({
            provider: decoded.provider,
            installationId: String(decoded.installationId),
            owner: decoded.owner,
            name: decoded.name,
            fullName: decoded.fullName,
            repositoryExternalId: decoded.repositoryExternalId,
            private: decoded.private,
          })),
          Effect.mapError(
            (cause) =>
              new SourceControlError({
                operation: 'listInstallationRepositories.decode',
                message:
                  'GitHub returned an invalid installation repository reference',
                cause,
              }),
          ),
        )
      })
    })

    const createIssueComment = Effect.fn(
      'GitHubProviderPlugin.createIssueComment',
    )(function* (input: {
      readonly provider: string
      readonly installationId?: string
      readonly owner: string
      readonly name: string
      readonly issueNumber: number
      readonly subjectKind?: 'issue' | 'pull-request' | undefined
      readonly body: string
      readonly idempotencyKey?: string | undefined
      readonly legacyIdempotencyKeys?: ReadonlyArray<string> | undefined
    }) {
      const installationId = yield* parseGitHubInstallationId(input)
      return yield* withPublicationOctokit({
        installationId,
        name: input.name,
        permission:
          input.subjectKind === 'pull-request' ? 'pull_requests' : 'issues',
        use: (octokit) =>
          Effect.tryPromise({
            try: async (signal) => {
              const marker =
                input.idempotencyKey === undefined
                  ? undefined
                  : publicationMarker(input.idempotencyKey)
              const acceptedMarkers = [
                ...(marker === undefined ? [] : [marker]),
                ...(input.legacyIdempotencyKeys ?? []).map(publicationMarker),
              ]
              if (marker !== undefined) {
                for (let page = 1; page <= 10; page += 1) {
                  const comments = await octokit.rest.issues.listComments({
                    owner: input.owner,
                    repo: input.name,
                    issue_number: input.issueNumber,
                    per_page: 100,
                    page,
                    request: { signal },
                  })
                  const candidates = comments.data.filter((comment) =>
                    acceptedMarkers.some((acceptedMarker) =>
                      comment.body?.includes(acceptedMarker),
                    ),
                  )
                  let expectedAppId =
                    candidates.length === 0 ||
                    !Number.isSafeInteger(configuredNumericAppId)
                      ? undefined
                      : configuredNumericAppId
                  if (candidates.length > 0 && expectedAppId === undefined) {
                    const identity = await app.octokit.request('GET /app', {
                      request: {
                        signal: githubProviderDeadlineSignal(signal),
                        redirect: 'manual',
                        retries: 0,
                      },
                    })
                    if (
                      identity.data === null ||
                      !Number.isSafeInteger(identity.data.id)
                    ) {
                      throw new Error(
                        'GitHub returned invalid authenticated App identity',
                      )
                    }
                    expectedAppId = identity.data.id
                  }
                  const existing = candidates.find(
                    (comment) =>
                      comment.performed_via_github_app?.id === expectedAppId,
                  )
                  if (existing !== undefined) {
                    const updated = await octokit.rest.issues.updateComment({
                      owner: input.owner,
                      repo: input.name,
                      comment_id: existing.id,
                      body: `${input.body}\n\n${marker}`,
                      request: { signal },
                    })
                    return {
                      externalId: String(updated.data.id),
                      url: updated.data.html_url,
                    }
                  }
                  if (comments.data.length < 100) break
                  if (page === 10) {
                    throw new Error(
                      'GitHub issue comment inventory exceeded publication bound',
                    )
                  }
                }
              }
              const result = await octokit.rest.issues.createComment({
                owner: input.owner,
                repo: input.name,
                issue_number: input.issueNumber,
                body:
                  marker === undefined
                    ? input.body
                    : `${input.body}\n\n${marker}`,
                request: { signal },
              })
              return {
                externalId: String(result.data.id),
                url: result.data.html_url,
              }
            },
            catch: (cause) =>
              new SourceControlError({
                operation: 'createIssueComment.github',
                message: 'GitHub failed to create an issue comment',
                cause,
              }),
          }),
      }).pipe(
        Effect.timeoutOrElse({
          duration: 30_000,
          orElse: () =>
            Effect.fail(
              new SourceControlError({
                operation: 'createIssueComment.github',
                message: 'GitHub issue comment publication timed out',
                cause: { timeoutMilliseconds: 30_000 },
              }),
            ),
        }),
      )
    })

    const createCheckRun = Effect.fn('GitHubProviderPlugin.createCheckRun')(
      function* (input: {
        readonly provider: string
        readonly installationId?: string
        readonly owner: string
        readonly name: string
        readonly headSha: string
        readonly checkName: string
        readonly status: 'completed'
        readonly conclusion:
          | 'success'
          | 'failure'
          | 'neutral'
          | 'cancelled'
          | 'skipped'
          | 'timed_out'
          | 'action_required'
        readonly title: string
        readonly summary: string
        readonly text?: string | undefined
        readonly detailsUrl?: string | undefined
        readonly idempotencyKey?: string | undefined
        readonly legacyIdempotencyKeys?: ReadonlyArray<string> | undefined
      }) {
        const installationId = yield* parseGitHubInstallationId(input)
        return yield* withPublicationOctokit({
          installationId,
          name: input.name,
          permission: 'checks',
          use: (octokit) =>
            Effect.tryPromise({
              try: async (signal) => {
                if (input.idempotencyKey !== undefined) {
                  for (let page = 1; page <= 10; page += 1) {
                    const checks = await octokit.rest.checks.listForRef({
                      owner: input.owner,
                      repo: input.name,
                      ref: input.headSha,
                      check_name: input.checkName,
                      filter: 'all',
                      per_page: 100,
                      page,
                      request: { signal },
                    })
                    const acceptedIds = new Set([
                      input.idempotencyKey,
                      ...(input.legacyIdempotencyKeys ?? []),
                    ])
                    const candidates = checks.data.check_runs.filter((check) =>
                      acceptedIds.has(check.external_id ?? ''),
                    )
                    let expectedAppId =
                      candidates.length === 0 ||
                      !Number.isSafeInteger(configuredNumericAppId)
                        ? undefined
                        : configuredNumericAppId
                    if (candidates.length > 0 && expectedAppId === undefined) {
                      const identity = await app.octokit.request('GET /app', {
                        request: {
                          signal: githubProviderDeadlineSignal(signal),
                          redirect: 'manual',
                          retries: 0,
                        },
                      })
                      if (
                        identity.data === null ||
                        !Number.isSafeInteger(identity.data.id)
                      ) {
                        throw new Error(
                          'GitHub returned invalid authenticated App identity',
                        )
                      }
                      expectedAppId = identity.data.id
                    }
                    const existing = candidates.find(
                      (check) => check.app?.id === expectedAppId,
                    )
                    if (existing !== undefined) {
                      const updated = await octokit.rest.checks.update({
                        owner: input.owner,
                        repo: input.name,
                        check_run_id: existing.id,
                        name: input.checkName,
                        external_id: input.idempotencyKey,
                        status: input.status,
                        conclusion: input.conclusion,
                        ...(input.detailsUrl === undefined
                          ? {}
                          : { details_url: input.detailsUrl }),
                        output: {
                          title: input.title,
                          summary: input.summary,
                          ...(input.text === undefined
                            ? {}
                            : { text: input.text }),
                        },
                        request: { signal },
                      })
                      return {
                        externalId: String(updated.data.id),
                        url: updated.data.html_url ?? undefined,
                      }
                    }
                    if (checks.data.check_runs.length < 100) break
                    if (page === 10) {
                      throw new Error(
                        'GitHub check run inventory exceeded publication bound',
                      )
                    }
                  }
                }
                const result = await octokit.rest.checks.create({
                  owner: input.owner,
                  repo: input.name,
                  name: input.checkName,
                  head_sha: input.headSha,
                  status: input.status,
                  conclusion: input.conclusion,
                  ...(input.idempotencyKey === undefined
                    ? {}
                    : { external_id: input.idempotencyKey }),
                  ...(input.detailsUrl === undefined
                    ? {}
                    : { details_url: input.detailsUrl }),
                  output: {
                    title: input.title,
                    summary: input.summary,
                    ...(input.text === undefined ? {} : { text: input.text }),
                  },
                  request: { signal },
                })
                return {
                  externalId: String(result.data.id),
                  url: result.data.html_url ?? undefined,
                }
              },
              catch: (cause) =>
                new SourceControlError({
                  operation: 'createCheckRun.github',
                  message: 'GitHub failed to create a check run',
                  cause,
                }),
            }),
        }).pipe(
          Effect.timeoutOrElse({
            duration: 30_000,
            orElse: () =>
              Effect.fail(
                new SourceControlError({
                  operation: 'createCheckRun.github',
                  message: 'GitHub check run publication timed out',
                  cause: { timeoutMilliseconds: 30_000 },
                }),
              ),
          }),
        )
      },
    )

    const createDraftPullRequest = Effect.fn(
      'GitHubProviderPlugin.createDraftPullRequest',
    )(function* (input: {
      readonly provider: string
      readonly installationId?: string
      readonly owner: string
      readonly name: string
      readonly title: string
      readonly head: string
      readonly base: string
      readonly body?: string | undefined
    }) {
      const installationId = yield* parseGitHubInstallationId(input)
      return yield* withPublicationOctokit({
        installationId,
        name: input.name,
        permission: 'pull_requests',
        use: (octokit) =>
          Effect.tryPromise({
            try: async (signal) => {
              const result = await octokit.rest.pulls.create({
                owner: input.owner,
                repo: input.name,
                title: input.title,
                head: input.head,
                base: input.base,
                draft: true,
                ...(input.body === undefined ? {} : { body: input.body }),
                request: { signal },
              })
              return {
                externalId: String(result.data.id),
                url: result.data.html_url,
              }
            },
            catch: (cause) =>
              new SourceControlError({
                operation: 'createDraftPullRequest.github',
                message: 'GitHub failed to create a draft pull request',
                cause,
              }),
          }),
      })
    })

    const createRepositoryCloneCredentials = Effect.fn(
      'GitHubProviderPlugin.createRepositoryCloneCredentials',
    )(function* (input: {
      readonly provider: string
      readonly installationId?: string
      readonly owner: string
      readonly name: string
      readonly repositoryExternalId?: string | undefined
    }) {
      const installationId = yield* parseGitHubInstallationId(input)
      const repositoryScope = yield* toGitHubRepositoryTokenScope(input)
      const token = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: async (signal) => {
            const result = await app.octokit.request(
              'POST /app/installations/{installation_id}/access_tokens',
              {
                installation_id: installationId,
                ...repositoryScope,
                permissions: { contents: 'read' },
                request: {
                  signal: githubProviderDeadlineSignal(signal),
                  redirect: 'manual',
                  retries: 0,
                },
              },
            )
            try {
              const cloneToken = decodeInstallationToken(result.data, {
                permission: 'contents',
                repositorySelection: 'selected',
                repository: {
                  name: input.name,
                  ...(input.repositoryExternalId === undefined
                    ? {}
                    : { id: Number(input.repositoryExternalId) }),
                },
              })
              return cloneToken
            } catch (cause) {
              const recoverableToken = rawInstallationToken(result.data)
              if (recoverableToken !== undefined) {
                const apiBaseUrl = (
                  baseUrl ?? 'https://api.github.com'
                ).replace(/\/$/, '')
                const response = await globalThis.fetch(
                  `${apiBaseUrl}/installation/token`,
                  {
                    method: 'DELETE',
                    headers: {
                      accept: 'application/vnd.github+json',
                      authorization: `Bearer ${recoverableToken}`,
                      'user-agent': 'patchplane',
                      'x-github-api-version': '2022-11-28',
                    },
                    redirect: 'manual',
                    signal: githubProviderDeadlineSignal(
                      new AbortController().signal,
                      5_000,
                    ),
                  },
                )
                cancelResponseBody(response)
                if (!response.ok) {
                  throw new Error(
                    'GitHub invalid clone token revocation failed',
                    { cause },
                  )
                }
              }
              throw cause
            }
          },
          catch: (cause) =>
            new SourceControlError({
              operation: 'createRepositoryCloneCredentials.github',
              message: 'GitHub failed to create installation clone credentials',
              cause,
            }),
        }),
        (releasedToken) =>
          Effect.tryPromise({
            try: async (signal) => {
              const apiBaseUrl = (baseUrl ?? 'https://api.github.com').replace(
                /\/$/,
                '',
              )
              const response = await globalThis.fetch(
                `${apiBaseUrl}/installation/token`,
                {
                  method: 'DELETE',
                  headers: {
                    accept: 'application/vnd.github+json',
                    authorization: `Bearer ${releasedToken}`,
                    'user-agent': 'patchplane',
                    'x-github-api-version': '2022-11-28',
                  },
                  redirect: 'manual',
                  signal: githubProviderDeadlineSignal(signal, 5_000),
                },
              )
              cancelResponseBody(response)
              if (!response.ok) {
                throw new Error('GitHub clone token revocation failed')
              }
            },
            catch: (cause) =>
              new SourceControlError({
                operation: 'createRepositoryCloneCredentials.revoke',
                message: 'GitHub clone token revocation failed',
                cause,
              }),
          }).pipe(Effect.orDie),
      )

      return {
        username: 'x-access-token',
        password: token,
      }
    })

    const fetchImmutableComparison = Effect.fn(
      'GitHubProviderPlugin.fetchImmutableComparison',
    )(function* (input: FetchImmutableComparisonInput) {
      if (
        !Number.isSafeInteger(input.maxBytes) ||
        input.maxBytes <= 0 ||
        (input.timeoutMilliseconds !== undefined &&
          (!Number.isSafeInteger(input.timeoutMilliseconds) ||
            input.timeoutMilliseconds <= 0))
      ) {
        return yield* new SourceControlError({
          operation: 'fetchImmutableComparison.validateLimit',
          message:
            'Immutable comparison requires positive byte and timeout limits',
          cause: {
            maxBytes: input.maxBytes,
            timeoutMilliseconds: input.timeoutMilliseconds,
          },
        })
      }
      const installationId = yield* parseGitHubInstallationId(input)
      const repositoryScope = yield* toGitHubRepositoryTokenScope({
        name: input.name,
      })
      const acquireComparisonToken = Effect.tryPromise({
        try: async (signal) => {
          const response = await app.octokit.request(
            'POST /app/installations/{installation_id}/access_tokens',
            {
              installation_id: installationId,
              ...repositoryScope,
              permissions: { contents: 'read' },
              request: {
                signal: githubProviderDeadlineSignal(signal),
                redirect: 'manual',
                retries: 0,
              },
            },
          )
          return response.data
        },
        catch: (cause) =>
          new SourceControlError({
            operation:
              cause instanceof ImmutableComparisonResponseError
                ? cause.operation
                : 'fetchImmutableComparison.authentication',
            message:
              cause instanceof ImmutableComparisonResponseError
                ? cause.message
                : 'GitHub failed to create comparison authentication',
            cause:
              cause instanceof ImmutableComparisonResponseError
                ? cause.details
                : cause,
          }),
      }).pipe(
        Effect.timeoutOrElse({
          duration: input.timeoutMilliseconds ?? 30_000,
          orElse: () =>
            Effect.fail(
              new SourceControlError({
                operation: 'fetchImmutableComparison.deadline',
                message: 'GitHub comparison exceeded the configured deadline',
                cause: {
                  timeoutMilliseconds: input.timeoutMilliseconds ?? 30_000,
                },
              }),
            ),
        }),
      )
      const fetchComparisonBytes = (token: string) =>
        Effect.tryPromise({
          try: async (effectSignal) => {
            const controller = new AbortController()
            const abortFromEffect = () => controller.abort(effectSignal.reason)
            if (effectSignal.aborted) abortFromEffect()
            else effectSignal.addEventListener('abort', abortFromEffect)
            let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
            try {
              const apiBaseUrl = (baseUrl ?? 'https://api.github.com').replace(
                /\/$/,
                '',
              )
              const comparisonUrl = `${apiBaseUrl}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.name)}/compare/${input.baseSha}...${input.headSha}`
              const response = await fetch(comparisonUrl, {
                method: 'GET',
                headers: {
                  accept: 'application/vnd.github.v3.diff',
                  authorization: `Bearer ${token}`,
                  'user-agent': 'patchplane',
                  'x-github-api-version': '2022-11-28',
                },
                redirect: 'manual',
                signal: controller.signal,
              })
              if (response.status === 406) {
                throw new ImmutableComparisonResponseError(
                  'fetchImmutableComparison.github',
                  'GitHub comparison diff is unavailable or truncated',
                  { status: response.status },
                )
              }
              if (response.status === 404) {
                throw new ImmutableComparisonResponseError(
                  'fetchImmutableComparison.github',
                  'GitHub comparison references a missing commit or repository',
                  { status: response.status },
                )
              }
              if (!response.ok) {
                throw new ImmutableComparisonResponseError(
                  'fetchImmutableComparison.github',
                  'GitHub failed to fetch the immutable comparison diff',
                  { status: response.status },
                )
              }
              const rawContentType = response.headers.get('content-type')
              const contentType = rawContentType
                ?.split(';', 1)[0]
                ?.trim()
                .toLowerCase()
              if (
                contentType !== 'application/vnd.github.v3.diff' &&
                contentType !== 'text/plain'
              ) {
                throw new ImmutableComparisonResponseError(
                  'fetchImmutableComparison.validateContentType',
                  'GitHub comparison returned an unexpected content type',
                  { contentType: rawContentType },
                )
              }
              const contentLength = response.headers.get('content-length')
              if (
                contentLength !== null &&
                response.headers.get('content-encoding') === null &&
                Number(contentLength) > input.maxBytes
              ) {
                throw new ImmutableComparisonResponseError(
                  'fetchImmutableComparison.size',
                  'GitHub comparison exceeds the configured byte limit',
                  { contentLength, maxBytes: input.maxBytes },
                )
              }
              if (response.body === null) {
                throw new ImmutableComparisonResponseError(
                  'fetchImmutableComparison.decode',
                  'GitHub comparison response body is unavailable',
                )
              }
              reader = response.body.getReader()
              const chunks: Array<Uint8Array> = []
              let sizeBytes = 0
              while (true) {
                const next = await reader.read()
                if (next.done) break
                sizeBytes += next.value.byteLength
                if (sizeBytes > input.maxBytes) {
                  void reader.cancel().catch(() => undefined)
                  throw new ImmutableComparisonResponseError(
                    'fetchImmutableComparison.size',
                    'GitHub comparison exceeds the configured byte limit',
                    { sizeBytes, maxBytes: input.maxBytes },
                  )
                }
                chunks.push(next.value)
              }
              if (
                contentLength !== null &&
                response.headers.get('content-encoding') === null &&
                Number(contentLength) !== sizeBytes
              ) {
                throw new ImmutableComparisonResponseError(
                  'fetchImmutableComparison.truncated',
                  'GitHub comparison byte length does not match the response',
                  { contentLength, sizeBytes },
                )
              }
              const body = new Uint8Array(sizeBytes)
              let offset = 0
              for (const chunk of chunks) {
                body.set(chunk, offset)
                offset += chunk.byteLength
              }
              let diffText: string
              try {
                diffText = new TextDecoder('utf-8', { fatal: true }).decode(
                  body,
                )
              } catch (cause) {
                throw new ImmutableComparisonResponseError(
                  'fetchImmutableComparison.decode',
                  'GitHub comparison is not valid UTF-8 diff text',
                  cause,
                )
              }
              if (
                /^Binary files .+ differ$/m.test(diffText) ||
                /^GIT binary patch$/m.test(diffText)
              ) {
                throw new ImmutableComparisonResponseError(
                  'fetchImmutableComparison.binary',
                  'GitHub comparison contains binary changes that the alpha cannot reproduce exactly',
                )
              }
              return body
            } finally {
              effectSignal.removeEventListener('abort', abortFromEffect)
              controller.abort()
              try {
                reader?.releaseLock()
              } catch {
                // The controller abort above owns nonblocking body cancellation.
              }
            }
          },
          catch: (cause) =>
            new SourceControlError({
              operation:
                cause instanceof ImmutableComparisonResponseError
                  ? cause.operation
                  : 'fetchImmutableComparison.github',
              message:
                cause instanceof ImmutableComparisonResponseError
                  ? cause.message
                  : 'GitHub failed to fetch the immutable comparison diff',
              cause:
                cause instanceof ImmutableComparisonResponseError
                  ? cause.details
                  : cause,
            }),
        })
      const revokeComparisonToken = (token: string) =>
        Effect.tryPromise({
          try: async (signal) => {
            const apiBaseUrl = (baseUrl ?? 'https://api.github.com').replace(
              /\/$/,
              '',
            )
            const response = await globalThis.fetch(
              `${apiBaseUrl}/installation/token`,
              {
                method: 'DELETE',
                headers: {
                  accept: 'application/vnd.github+json',
                  authorization: `Bearer ${token}`,
                  'user-agent': 'patchplane',
                  'x-github-api-version': '2022-11-28',
                },
                redirect: 'manual',
                signal: githubProviderDeadlineSignal(signal, 5_000),
              },
            )
            cancelResponseBody(response)
            if (!response.ok) {
              throw Object.assign(
                new Error('GitHub comparison token revocation failed'),
                { status: response.status },
              )
            }
          },
          catch: (cause) =>
            new SourceControlError({
              operation: 'fetchImmutableComparison.revoke',
              message: 'GitHub comparison token revocation failed',
              cause: {
                errorType: cause instanceof Error ? cause.name : typeof cause,
                ...(cause instanceof TypeError
                  ? {
                      errorDetail: cause.message
                        .replace(/https?:\/\/\S+/g, '[url]')
                        .slice(0, 256),
                    }
                  : {}),
                ...(typeof cause === 'object' &&
                cause !== null &&
                typeof Reflect.get(cause, 'status') === 'number'
                  ? { status: Reflect.get(cause, 'status') as number }
                  : {}),
              },
            }),
        }).pipe(
          Effect.timeoutOrElse({
            duration: 5_000,
            orElse: () =>
              Effect.fail(
                new SourceControlError({
                  operation: 'fetchImmutableComparison.revoke',
                  message: 'GitHub comparison token revocation timed out',
                  cause: { timeoutMilliseconds: 5_000 },
                }),
              ),
          }),
        )
      const bytes = yield* Effect.acquireUseRelease(
        acquireComparisonToken,
        (tokenData) =>
          Effect.try({
            try: () =>
              decodeInstallationToken(tokenData, {
                permission: 'contents',
                repositorySelection: 'selected',
                repository: { name: input.name },
              }),
            catch: (cause) =>
              new SourceControlError({
                operation: 'fetchImmutableComparison.authentication',
                message: 'GitHub returned invalid comparison authentication',
                cause,
              }),
          }).pipe(Effect.flatMap(fetchComparisonBytes)),
        (tokenData) => {
          const token = rawInstallationToken(tokenData)
          return token === undefined
            ? Effect.void
            : revokeComparisonToken(token)
        },
      ).pipe(
        Effect.timeoutOrElse({
          duration: input.timeoutMilliseconds ?? 30_000,
          orElse: () =>
            Effect.fail(
              new SourceControlError({
                operation: 'fetchImmutableComparison.deadline',
                message: 'GitHub comparison exceeded the configured deadline',
                cause: {
                  timeoutMilliseconds: input.timeoutMilliseconds ?? 30_000,
                },
              }),
            ),
        }),
      )
      return {
        provider: 'github' as const,
        baseSha: input.baseSha,
        headSha: input.headSha,
        contentType: 'application/vnd.github.v3.diff' as const,
        bytes,
      }
    })

    return SourceControlService.of({
      verifyRepositoryAccess,
      getInstallationAccount,
      verifyGitHubInstallationOwnership,
      listInstallationRepositories,
      createIssueComment,
      createCheckRun,
      createDraftPullRequest,
      createRepositoryCloneCredentials,
      fetchImmutableComparison,
    })
  }),
)

const githubWebhookLayer = Layer.effect(
  GitHubWebhookService,
  Effect.gen(function* () {
    const config = yield* GitHubConfig
    const { app, baseUrl } = makeGitHubApp(config)

    yield* Effect.logInfo('Initialized GitHub webhook provider plugin', {
      appId: config.appId,
      ...(baseUrl === undefined ? {} : { baseUrl }),
    })

    const verifyWebhook = Effect.fn('GitHubProviderPlugin.verifyWebhook')(
      function* (input: {
        readonly deliveryId: string
        readonly eventName: string
        readonly signature: string
        readonly payload: string
      }) {
        yield* Effect.annotateCurrentSpan({
          deliveryId: input.deliveryId,
          eventName: input.eventName,
        })

        const isValid = yield* Effect.tryPromise({
          try: () => app.webhooks.verify(input.payload, input.signature),
          catch: (cause) =>
            new GitHubError({
              operation: 'verifyGitHubWebhook',
              message: 'GitHub failed to verify the webhook signature',
              cause,
            }),
        })

        if (!isValid) {
          return yield* new GitHubError({
            operation: 'verifyGitHubWebhook',
            message: 'GitHub webhook signature is invalid',
            cause: null,
          })
        }

        const payload = yield* Effect.try({
          try: () => JSON.parse(input.payload) as unknown,
          catch: (cause) =>
            new GitHubError({
              operation: 'verifyGitHubWebhook.parse',
              message: 'GitHub webhook payload is not valid JSON',
              cause,
            }),
        })

        return yield* decodeGitHubWebhookVerification({
          deliveryId: input.deliveryId,
          eventName: input.eventName,
          payload,
        }).pipe(
          Effect.mapError(
            (cause) =>
              new GitHubError({
                operation: 'verifyGitHubWebhook.decode',
                message: 'GitHub webhook verification result is invalid',
                cause,
              }),
          ),
        )
      },
    )

    return GitHubWebhookService.of({ verifyWebhook })
  }),
)

export const GitHubProviderPlugin = {
  layer: Layer.merge(sourceControlLayer, githubWebhookLayer),
  config: GitHubConfig,
}
