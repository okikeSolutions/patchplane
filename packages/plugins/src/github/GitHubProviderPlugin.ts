import { Effect, Layer, Option, Redacted } from 'effect'
import { App, Octokit, RequestError } from 'octokit'
import { GitHubError, SourceControlError } from '@patchplane/domain/errors'
import {
  decodeGitHubRepositoryRef,
  decodeGitHubWebhookVerification,
} from '@patchplane/domain/github'
import { GitHubWebhookService } from '@patchplane/core/services/github-webhook-service'
import { SourceControlService } from '@patchplane/core/services/source-control-service'
import { GitHubConfig } from './GitHubConfig'

function githubCause(cause: unknown) {
  if (cause instanceof RequestError) {
    return {
      name: cause.name,
      message: cause.message,
      status: cause.status,
      request: {
        method: cause.request.method,
        url: cause.request.url,
      },
    }
  }

  return cause
}

function parseWebhookPayload(payload: string) {
  return JSON.parse(payload) as unknown
}

function appFromConfig(config: GitHubConfig) {
  const baseUrl = Option.getOrUndefined(config.baseUrl)
  const OctokitForApp = baseUrl === undefined ? Octokit : Octokit.defaults({ baseUrl })
  return {
    baseUrl,
    app: new App({
      appId: config.appId,
      privateKey: Redacted.value(config.privateKey),
      webhooks: { secret: Redacted.value(config.webhookSecret) },
      Octokit: OctokitForApp,
    }),
  }
}

function parseGitHubInstallationId(input: {
  readonly provider: string
  readonly installationId?: string
}) {
  if (input.provider !== 'github') {
    return Effect.fail(
      new SourceControlError({
        operation: 'GitHubProviderPlugin.parseGitHubInstallationId',
        message: `Unsupported source-control provider: ${input.provider}`,
        cause: input,
      }),
    )
  }

  if (input.installationId === undefined) {
    return Effect.fail(
      new SourceControlError({
        operation: 'GitHubProviderPlugin.parseGitHubInstallationId',
        message: 'GitHub operations require an installation id',
        cause: input,
      }),
    )
  }

  const installationId = Number(input.installationId)
  if (!Number.isSafeInteger(installationId)) {
    return Effect.fail(
      new SourceControlError({
        operation: 'GitHubProviderPlugin.parseGitHubInstallationId',
        message: 'GitHub operation received an invalid installation id',
        cause: input,
      }),
    )
  }

  return Effect.succeed(installationId)
}

const sourceControlLayer = Layer.effect(
  SourceControlService,
  Effect.gen(function* () {
    const config = yield* GitHubConfig
    const { app, baseUrl } = appFromConfig(config)

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
            cause: githubCause(cause),
          }),
      })

      const decoded = yield* decodeGitHubRepositoryRef({
        provider: 'github',
        installationId,
        owner: repository.owner.login,
        name: repository.name,
        fullName: repository.full_name,
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
      }
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
            cause: githubCause(cause),
          }),
      })
    })

    return SourceControlService.of({
      verifyRepositoryAccess,
      createIssueComment,
    })
  }),
)

const githubWebhookLayer = Layer.effect(
  GitHubWebhookService,
  Effect.gen(function* () {
    const config = yield* GitHubConfig
    const { app, baseUrl } = appFromConfig(config)

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
            cause: githubCause(cause),
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
        try: () => parseWebhookPayload(input.payload),
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
