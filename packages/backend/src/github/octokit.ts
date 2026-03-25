import { Effect } from 'effect'
import { App, Octokit } from 'octokit'
import type {
  BoundaryFailure,
  GitHubAppAuth,
  GitHubInstallation,
  GitHubInstallationScope,
  GitHubInstallationToken,
  GitHubPublicationCommand,
  GitHubPublicationReceipt,
  GitHubPublisher,
  GitHubRepositoryAccess,
  GitHubRepositorySync,
  GitHubWebhookDeliveryAttempt,
} from '@patchplane/domain'

export interface GitHubAppOptions {
  readonly appId: number
  readonly privateKey: string
  readonly webhookSecret?: string
  readonly baseUrl?: string
}

function toBoundaryFailure(
  boundary: string,
  message: string,
  cause: unknown,
): BoundaryFailure {
  return {
    boundary,
    message,
    retryable: true,
    cause,
  }
}

function normalizeAccountType(type: string | undefined) {
  return type === 'User' ? 'User' : 'Organization'
}

function normalizeRepositoryAccess(repository: {
  id: number
  node_id: string
  full_name: string
  owner?: { login?: string | null }
  name: string
  default_branch?: string | null
  private: boolean
  archived: boolean
  disabled?: boolean
}): GitHubRepositoryAccess {
  const [ownerFromFullName = '', nameFromFullName = repository.name] =
    repository.full_name.split('/')

  return {
    externalRepositoryId: repository.id,
    externalNodeId: repository.node_id,
    fullName: repository.full_name,
    owner: repository.owner?.login ?? ownerFromFullName,
    name: repository.name ?? nameFromFullName,
    defaultBranch: repository.default_branch ?? 'main',
    isPrivate: repository.private,
    isArchived: repository.archived,
    isDisabled: repository.disabled ?? false,
  }
}

type GitHubAccessibleRepository = Parameters<
  typeof normalizeRepositoryAccess
>[0]

interface GitHubAppWebhookDeliveryResponse {
  readonly id: number
  readonly guid: string
  readonly status: string
  readonly delivered_at: string
  readonly redelivery: boolean
}

async function listRepositoryAccess(
  app: App,
  externalInstallationId: number,
): Promise<ReadonlyArray<GitHubRepositoryAccess>> {
  const octokit = await app.getInstallationOctokit(externalInstallationId)
  const repositories: GitHubRepositoryAccess[] = []

  for await (const page of octokit.paginate.iterator(
    octokit.rest.apps.listReposAccessibleToInstallation,
    {
      per_page: 100,
    },
  )) {
    repositories.push(
      ...(page.data as ReadonlyArray<GitHubAccessibleRepository>).map(
        (repository) => normalizeRepositoryAccess(repository),
      ),
    )
  }

  return repositories
}

export function createGitHubApp(options: GitHubAppOptions) {
  return new App({
    appId: options.appId,
    privateKey: options.privateKey,
    Octokit: options.baseUrl
      ? Octokit.defaults({ baseUrl: options.baseUrl })
      : Octokit,
    ...(options.webhookSecret
      ? {
          webhooks: {
            secret: options.webhookSecret,
          },
        }
      : {}),
  })
}

export function listAppWebhookDeliveriesSince(
  app: App,
  deliveredSince: number,
): Effect.Effect<ReadonlyArray<GitHubWebhookDeliveryAttempt>, BoundaryFailure> {
  return Effect.tryPromise({
    try: async () => {
      const deliveries: GitHubWebhookDeliveryAttempt[] = []

      for await (const page of app.octokit.paginate.iterator(
        'GET /app/hook/deliveries',
        {
          per_page: 100,
        },
      )) {
        const normalizedPage = (
          page.data as ReadonlyArray<GitHubAppWebhookDeliveryResponse>
        ).map((delivery) => ({
          attemptId: delivery.id,
          guid: delivery.guid,
          status: delivery.status,
          deliveredAt: delivery.delivered_at,
          redelivery: delivery.redelivery,
        }))

        deliveries.push(
          ...normalizedPage.filter(
            (delivery) => Date.parse(delivery.deliveredAt) >= deliveredSince,
          ),
        )

        const oldestDelivery = normalizedPage.at(-1)

        if (
          oldestDelivery &&
          Date.parse(oldestDelivery.deliveredAt) < deliveredSince
        ) {
          break
        }
      }

      return deliveries
    },
    catch: (cause) =>
      toBoundaryFailure(
        'github.webhooks',
        `Failed to list GitHub App webhook deliveries since ${new Date(
          deliveredSince,
        ).toISOString()}.`,
        cause,
      ),
  })
}

export function redeliverAppWebhookDelivery(
  app: App,
  deliveryId: number,
): Effect.Effect<void, BoundaryFailure> {
  return Effect.tryPromise({
    try: async () => {
      await app.octokit.request('POST /app/hook/deliveries/{delivery_id}/attempts', {
        delivery_id: deliveryId,
      })
    },
    catch: (cause) =>
      toBoundaryFailure(
        'github.webhooks',
        `Failed to request a redelivery for GitHub App webhook delivery ${deliveryId}.`,
        cause,
      ),
  })
}

export class OctokitGitHubAppAuth implements GitHubAppAuth {
  readonly name = 'octokit-github-app-auth'

  constructor(private readonly app: App) {}

  getInstallationToken(
    externalInstallationId: number,
  ): Effect.Effect<GitHubInstallationToken, BoundaryFailure> {
    return Effect.tryPromise({
      try: async () => {
        const octokit = await this.app.getInstallationOctokit(
          externalInstallationId,
        )
        const auth = (await octokit.auth({
          type: 'installation',
        })) as {
          readonly token: string
          readonly expiresAt?: string
          readonly expires_at?: string
        }

        return {
          token: auth.token,
          expiresAt:
            auth.expiresAt ?? auth.expires_at ?? new Date().toISOString(),
        }
      },
      catch: (cause) =>
        toBoundaryFailure(
          'github.appAuth',
          `Failed to mint installation token for installation ${externalInstallationId}.`,
          cause,
        ),
    })
  }

  resolveInstallationScope(
    externalInstallationId: number,
  ): Effect.Effect<GitHubInstallationScope, BoundaryFailure> {
    return Effect.tryPromise({
      try: async () => {
        const installation = await this.app.octokit.request(
          'GET /app/installations/{installation_id}',
          {
            installation_id: externalInstallationId,
          },
        )
        const repositories = await listRepositoryAccess(
          this.app,
          externalInstallationId,
        )
        const account = installation.data.account as
          | {
              readonly login?: string | null
              readonly type?: string | null
            }
          | undefined

        return {
          externalInstallationId,
          accountLogin: account?.login ?? 'unknown',
          accountType: normalizeAccountType(account?.type ?? undefined),
          targetType: normalizeAccountType(installation.data.target_type),
          repositorySelection:
            installation.data.repository_selection === 'all'
              ? 'all'
              : 'selected',
          permissions: Object.fromEntries(
            Object.entries(installation.data.permissions ?? {}).map(
              ([key, value]) => [key, String(value)],
            ),
          ),
          repositories,
          syncedAt: Date.now(),
        }
      },
      catch: (cause) =>
        toBoundaryFailure(
          'github.appAuth',
          `Failed to resolve installation scope for installation ${externalInstallationId}.`,
          cause,
        ),
    })
  }
}

export class OctokitGitHubRepositorySync implements GitHubRepositorySync {
  readonly name = 'octokit-github-repository-sync'

  constructor(private readonly auth: GitHubAppAuth) {}

  syncInstallation(
    installation: GitHubInstallation,
  ): Effect.Effect<GitHubInstallationScope, BoundaryFailure> {
    return this.auth.resolveInstallationScope(
      installation.externalInstallationId,
    )
  }
}

export class OctokitGitHubPublisher implements GitHubPublisher {
  readonly name = 'octokit-github-publisher'

  constructor(private readonly app: App) {}

  private buildCheckRunOutput(command: {
    readonly name: string
    readonly summary: string
    readonly text: string | undefined
  }) {
    return {
      title: command.name,
      summary: command.summary,
      ...(command.text ? { text: command.text } : {}),
    }
  }

  publish(
    command: GitHubPublicationCommand,
  ): Effect.Effect<GitHubPublicationReceipt, BoundaryFailure> {
    return Effect.tryPromise({
      try: async () => {
        const octokit = await this.app.getInstallationOctokit(
          command.externalInstallationId,
        )

        switch (command.kind) {
          case 'issue_comment': {
            const response = command.existingCommentId
              ? await octokit.rest.issues.updateComment({
                  owner: command.owner,
                  repo: command.repo,
                  comment_id: command.existingCommentId,
                  body: command.body,
                })
              : await octokit.rest.issues.createComment({
                  owner: command.owner,
                  repo: command.repo,
                  issue_number: command.issueNumber,
                  body: command.body,
                })

            return {
              kind: 'issue_comment',
              externalPublicationId: String(response.data.id),
            }
          }
          case 'check_run': {
            const response = command.existingCheckRunId
              ? await octokit.rest.checks.update({
                  owner: command.owner,
                  repo: command.repo,
                  check_run_id: command.existingCheckRunId,
                  name: command.name,
                  status: command.status,
                  ...(command.conclusion
                    ? { conclusion: command.conclusion }
                    : {}),
                  output: this.buildCheckRunOutput({
                    name: command.name,
                    summary: command.summary,
                    text: command.text,
                  }),
                })
              : await octokit.rest.checks.create({
                  owner: command.owner,
                  repo: command.repo,
                  name: command.name,
                  head_sha: command.headSha,
                  status: command.status,
                  ...(command.conclusion
                    ? { conclusion: command.conclusion }
                    : {}),
                  output: this.buildCheckRunOutput({
                    name: command.name,
                    summary: command.summary,
                    text: command.text,
                  }),
                })

            return {
              kind: 'check_run',
              externalPublicationId: String(response.data.id),
            }
          }
          case 'pull_request': {
            const response = command.existingPullRequestNumber
              ? await octokit.rest.pulls.update({
                  owner: command.owner,
                  repo: command.repo,
                  pull_number: command.existingPullRequestNumber,
                  title: command.title,
                  body: command.body,
                  base: command.base,
                  state: 'open',
                })
              : await octokit.rest.pulls.create({
                  owner: command.owner,
                  repo: command.repo,
                  title: command.title,
                  body: command.body,
                  head: command.head,
                  base: command.base,
                  draft: command.draft,
                })

            return {
              kind: 'pull_request',
              externalPublicationId: String(response.data.number),
            }
          }
        }
      },
      catch: (cause) =>
        toBoundaryFailure(
          'github.publisher',
          `Failed to publish GitHub ${command.kind}.`,
          cause,
        ),
    })
  }
}
