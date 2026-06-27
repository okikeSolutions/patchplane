import { Effect, Layer } from 'effect'
import { GitHubError, SourceControlError } from '@patchplane/domain/errors'
import {
  decodeGitHubRepositoryRef,
  decodeGitHubWebhookVerification,
} from '@patchplane/domain/github'
import { GitHubWebhookService } from '@patchplane/core/services/github-webhook-service'
import { SourceControlService } from '@patchplane/core/services/source-control-service'
import { GitHubConfig } from './GitHubConfig'
import { makeGitHubApp } from './github-app'
import { parseGitHubInstallationId } from './github-installation'

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

const sourceControlLayer = Layer.effect(
  SourceControlService,
  Effect.gen(function* () {
    const config = yield* GitHubConfig
    const { app, baseUrl } = makeGitHubApp(config)

    yield* Effect.logInfo('Initialized GitHub source-control provider plugin', {
      appId: config.appId,
      ...(baseUrl === undefined ? {} : { baseUrl }),
    })

    const verifyRepositoryAccess = Effect.fn(
      'GitHubProviderPlugin.verifyRepositoryAccess',
    )(function*(input: {
      readonly provider: string
      readonly installationId?: string
      readonly owner: string
      readonly name: string
    }) {
      const installationId = yield* parseGitHubInstallationId(input)
      const repository = yield* Effect.tryPromise({
        try: async () => {
          const octokit = await app.getInstallationOctokit(installationId)
          const result = await octokit.rest.repos.get({
            owner: input.owner,
            repo: input.name,
          })
          return result.data
        },
        catch: (cause) =>
          new SourceControlError({
            operation: 'verifyRepositoryAccess.github',
            message: 'GitHub failed to verify repository access',
            cause,
          }),
      })

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
    )(function*(input: {
      readonly provider: string
      readonly installationId?: string
    }) {
      const installationId = yield* parseGitHubInstallationId(input)
      const installation = yield* Effect.tryPromise({
        try: async () => {
          const result = await app.octokit.request(
            'GET /app/installations/{installation_id}',
            { installation_id: installationId },
          )
          return result.data
        },
        catch: (cause) =>
          new SourceControlError({
            operation: 'getInstallationAccount.github',
            message: 'GitHub failed to get installation account',
            cause,
          }),
      })

      const account = installation.account
      if (account === null) {
        return yield* new SourceControlError({
          operation: 'getInstallationAccount.github',
          message: 'GitHub installation has no account',
          cause: installation,
        })
      }

      return {
        provider: 'github',
        installationId: String(installationId),
        accountExternalId: String(account.id),
        accountLogin: 'login' in account ? account.login : account.slug,
        accountType: 'type' in account ? account.type : 'Enterprise',
      }
    })

    const listInstallationRepositories = Effect.fn(
      'GitHubProviderPlugin.listInstallationRepositories',
    )(function*(input: {
      readonly provider: string
      readonly installationId?: string
    }) {
      const installationId = yield* parseGitHubInstallationId(input)
      const repositories = yield* Effect.tryPromise({
        try: async () => {
          const octokit = await app.getInstallationOctokit(installationId)
          return await octokit.paginate(
            octokit.rest.apps.listReposAccessibleToInstallation,
            { per_page: 100 },
          )
        },
        catch: (cause) =>
          new SourceControlError({
            operation: 'listInstallationRepositories.github',
            message: 'GitHub failed to list installation repositories',
            cause,
          }),
      })

      return yield* Effect.forEach(repositories, (repository) => {
        const ownerLogin = typeof repository.owner === 'object' &&
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
                message: 'GitHub returned an invalid installation repository reference',
                cause,
              }),
          ),
        )
      })
    })

    const createIssueComment = Effect.fn(
      'GitHubProviderPlugin.createIssueComment',
    )(function*(input: {
      readonly provider: string
      readonly installationId?: string
      readonly owner: string
      readonly name: string
      readonly issueNumber: number
      readonly body: string
    }) {
      const installationId = yield* parseGitHubInstallationId(input)
      yield* Effect.tryPromise({
        try: async () => {
          const octokit = await app.getInstallationOctokit(installationId)
          await octokit.rest.issues.createComment({
            owner: input.owner,
            repo: input.name,
            issue_number: input.issueNumber,
            body: input.body,
          })
        },
        catch: (cause) =>
          new SourceControlError({
            operation: 'createIssueComment.github',
            message: 'GitHub failed to create an issue comment',
            cause,
          }),
      })
    })

    const createRepositoryCloneCredentials = Effect.fn(
      'GitHubProviderPlugin.createRepositoryCloneCredentials',
    )(function*(input: {
      readonly provider: string
      readonly installationId?: string
      readonly owner: string
      readonly name: string
      readonly repositoryExternalId?: string | undefined
    }) {
      const installationId = yield* parseGitHubInstallationId(input)
      const repositoryScope = yield* toGitHubRepositoryTokenScope(input)
      const token = yield* Effect.tryPromise({
        try: async () => {
          const result = await app.octokit.request(
            'POST /app/installations/{installation_id}/access_tokens',
            {
              installation_id: installationId,
              ...repositoryScope,
              permissions: { contents: 'read' },
            },
          )
          return result.data.token
        },
        catch: (cause) =>
          new SourceControlError({
            operation: 'createRepositoryCloneCredentials.github',
            message: 'GitHub failed to create installation clone credentials',
            cause,
          }),
      })

      return {
        username: 'x-access-token',
        password: token,
      }
    })

    return SourceControlService.of({
      verifyRepositoryAccess,
      getInstallationAccount,
      listInstallationRepositories,
      createIssueComment,
      createRepositoryCloneCredentials,
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

    const verifyWebhook = Effect.fn(
      'GitHubProviderPlugin.verifyWebhook',
    )(function*(input: {
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
    })

    return GitHubWebhookService.of({ verifyWebhook })
  }),
)

export const GitHubProviderPlugin = {
  layer: Layer.merge(sourceControlLayer, githubWebhookLayer),
  config: GitHubConfig,
}
