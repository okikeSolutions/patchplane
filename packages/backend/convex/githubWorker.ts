'use node'

import { Duration, Effect, Schedule } from 'effect'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { internalAction, type ActionCtx } from './_generated/server'
import { v } from 'convex/values'
import type {
  GitHubAppAuth,
  GitHubWebhookDeliveryClient,
  GitHubWebhookEnvelope,
  GitHubWebhookIngestor,
  PatchPlaneCommand,
} from '@patchplane/domain'
import {
  GitHubAppAuthService,
  GitHubWebhookDeliveryClientService,
  GitHubWebhookIngestorService,
} from '@patchplane/domain'
import { processPatchPlaneCommandsWithQueue } from '../src/github/commandQueue'
import { createGitHubApp } from '../src/github/octokit'
import { GitHubBoundaryLive } from '../src/github/layers'

const webhookReconciliationKey = 'app_webhook_redelivery'
const initialWebhookReconciliationLookbackMs = 7 * 24 * 60 * 60 * 1000

type GitHubWorkerResult = {
  readonly status: string
  readonly commandCount: number
}

type ReconciliationResult = {
  readonly status: string
  readonly scannedDeliveries: number
  readonly redeliveredDeliveries: number
}

type ConvexPromptRequestCommand = Omit<PatchPlaneCommand, 'scope'> & {
  scope: {
    repoUrl: string
    baseBranch: string
    targetBranch: string
    includePaths: string[]
    excludePaths: string[]
    intent: string
  }
}

interface DeliveryForProcessing {
  readonly deliveryId: string
  readonly event: string
  readonly action?: string
  readonly externalInstallationId?: number
  readonly externalRepositoryId?: number
  readonly repositoryFullName?: string
  readonly repositoryNodeId?: string
  readonly status: string
  readonly signatureVerified: boolean
  readonly commandEmitted: boolean
  readonly payload: string
  readonly promptRequestId?: string
  readonly workflowRunId?: string
  readonly receivedAt: number
  readonly processedAt?: number
  readonly errorMessage?: string
}

function readErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Unknown GitHub worker failure.'
}

function createGitHubAppFromEnv() {
  return createGitHubApp({
    appId: Number(process.env.GITHUB_APP_ID ?? 0),
    privateKey: (process.env.GITHUB_APP_PRIVATE_KEY ?? '').replace(
      /\\n/g,
      '\n',
    ),
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? '',
    ...(process.env.GITHUB_API_BASE_URL
      ? { baseUrl: process.env.GITHUB_API_BASE_URL }
      : {}),
  })
}

function runGitHubBoundary<A>(effect: Effect.Effect<A, unknown, never>) {
  return Effect.runPromise(effect)
}

function provideGitHubBoundary<A>(
  effect: Effect.Effect<A, unknown, unknown>,
): Effect.Effect<A, unknown, never> {
  return Effect.provide(effect, GitHubBoundaryLive) as Effect.Effect<
    A,
    unknown,
    never
  >
}

function withGitHubRetry<A>(
  effect: Effect.Effect<A, unknown, never>,
): Effect.Effect<A, unknown, never> {
  return Effect.retry(
    effect,
    Schedule.intersect(
      Schedule.exponential(Duration.seconds(1)),
      Schedule.recurs(3),
    ),
  )
}

async function resolveGitHubAppAuth(): Promise<GitHubAppAuth> {
  return runGitHubBoundary(
    provideGitHubBoundary(
      Effect.flatMap(GitHubAppAuthService, (auth) => Effect.succeed(auth)),
    ),
  )
}

async function resolveWebhookIngestor(): Promise<GitHubWebhookIngestor> {
  return runGitHubBoundary(
    provideGitHubBoundary(
      Effect.flatMap(GitHubWebhookIngestorService, (ingestor) =>
        Effect.succeed(ingestor),
      ),
    ),
  )
}

async function resolveWebhookDeliveryClient(): Promise<GitHubWebhookDeliveryClient> {
  return runGitHubBoundary(
    provideGitHubBoundary(
      Effect.flatMap(GitHubWebhookDeliveryClientService, (client) =>
        Effect.succeed(client),
      ),
    ),
  )
}

function toWebhookEnvelope(delivery: DeliveryForProcessing): GitHubWebhookEnvelope {
  return {
    deliveryId: delivery.deliveryId,
    event: delivery.event,
    action: delivery.action,
    externalInstallationId: delivery.externalInstallationId,
    externalRepositoryId: delivery.externalRepositoryId,
    repositoryFullName: delivery.repositoryFullName,
    repositoryNodeId: delivery.repositoryNodeId,
    payload: delivery.payload,
    receivedAt: delivery.receivedAt,
  }
}

function toConvexPromptRequestCommand(
  command: PatchPlaneCommand,
): ConvexPromptRequestCommand {
  return {
    ...command,
    scope: {
      ...command.scope,
      includePaths: [...command.scope.includePaths],
      excludePaths: [...command.scope.excludePaths],
    },
  }
}

async function createPromptRequestsFromCommands(
  ctx: ActionCtx,
  deliveryRecordId: Id<'webhookDeliveries'>,
  commands: ReadonlyArray<PatchPlaneCommand>,
) {
  await runGitHubBoundary(
    processPatchPlaneCommandsWithQueue(commands, (command) =>
      Effect.promise(() =>
        ctx.runMutation(internal.github.createPromptRequestFromCommand, {
          deliveryRecordId,
          command: toConvexPromptRequestCommand(command),
        }),
      ),
    ) as Effect.Effect<void, unknown, never>,
  )
}

async function syncInstallationFromCallbackHandler(
  ctx: ActionCtx,
  externalInstallationId: number,
): Promise<{
  readonly githubInstallationId: string
  readonly repositoryCount: number
}> {
  const auth = await resolveGitHubAppAuth()
  const scope = await runGitHubBoundary(
    provideGitHubBoundary(auth.resolveInstallationScope(externalInstallationId)),
  )

  const githubInstallationId = await ctx.runMutation(
    internal.github.upsertInstallationScope,
    {
      externalInstallationId: scope.externalInstallationId,
      accountLogin: scope.accountLogin,
      accountType: scope.accountType,
      targetType: scope.targetType,
      repositorySelection: scope.repositorySelection,
      permissions: scope.permissions,
      installedByUserId: undefined,
      syncedAt: scope.syncedAt,
    },
  )

  await ctx.runMutation(internal.github.upsertRepositoryConnections, {
    githubInstallationId,
    repositories: scope.repositories.map((repository) => ({
      externalRepositoryId: repository.externalRepositoryId,
      externalNodeId: repository.externalNodeId,
      fullName: repository.fullName,
      owner: repository.owner,
      name: repository.name,
      defaultBranch: repository.defaultBranch,
      isPrivate: repository.isPrivate,
      isArchived: repository.isArchived,
      isDisabled: repository.isDisabled,
    })),
    syncedAt: scope.syncedAt,
  })

  return {
    githubInstallationId: String(githubInstallationId),
    repositoryCount: scope.repositories.length,
  }
}

async function verifyWebhookDeliveryHandler(args: {
  readonly deliveryId: string
  readonly event: string
  readonly payload: string
  readonly signature256: string
}): Promise<{
  readonly valid: boolean
  readonly shouldQueue: boolean
  readonly errorMessage?: string
}> {
  const app = createGitHubAppFromEnv()
  let shouldQueue = false

  app.webhooks.on('issue_comment.created', () => {
    shouldQueue = true
  })

  try {
    await app.webhooks.verifyAndReceive({
      id: args.deliveryId,
      name: args.event,
      payload: args.payload,
      signature: args.signature256,
    })

    return {
      valid: true,
      shouldQueue,
      errorMessage: undefined,
    }
  } catch (error) {
    return {
      valid: false,
      shouldQueue: false,
      errorMessage: readErrorMessage(error),
    }
  }
}

async function processWebhookDeliveryHandler(
  ctx: ActionCtx,
  args: { readonly deliveryRecordId: Id<'webhookDeliveries'> },
): Promise<GitHubWorkerResult> {
  const delivery = await ctx.runQuery(internal.github.getWebhookDeliveryForProcessing, {
    deliveryRecordId: args.deliveryRecordId,
  })

  if (!delivery) {
    return {
      status: 'failed',
      commandCount: 0,
    }
  }

  if (!delivery.signatureVerified) {
    await ctx.runMutation(internal.github.markWebhookDeliveryOutcome, {
      deliveryRecordId: args.deliveryRecordId,
      status: 'failed',
      commandEmitted: false,
      errorMessage:
        'Webhook delivery was not signature verified before processing.',
    })

    return {
      status: 'failed',
      commandCount: 0,
    }
  }

  try {
    const ingestor = await resolveWebhookIngestor()
    const commands = await runGitHubBoundary(
      provideGitHubBoundary(ingestor.ingest(toWebhookEnvelope(delivery))),
    )

    if (commands.length === 0) {
      await ctx.runMutation(internal.github.markWebhookDeliveryOutcome, {
        deliveryRecordId: args.deliveryRecordId,
        status: 'ignored',
        commandEmitted: false,
        errorMessage: undefined,
      })

      return {
        status: 'ignored',
        commandCount: 0,
      }
    }

    await createPromptRequestsFromCommands(
      ctx,
      args.deliveryRecordId,
      commands,
    )

    return {
      status: 'accepted',
      commandCount: commands.length,
    }
  } catch (error) {
    await ctx.runMutation(internal.github.markWebhookDeliveryOutcome, {
      deliveryRecordId: args.deliveryRecordId,
      status: 'failed',
      commandEmitted: false,
      errorMessage: readErrorMessage(error),
    })

    return {
      status: 'failed',
      commandCount: 0,
    }
  }
}

async function reconcileWebhookDeliveriesHandler(
  ctx: ActionCtx,
): Promise<ReconciliationResult> {
  const runStartedAt = Date.now()
  const reconciliation = await ctx.runMutation(
    internal.github.beginWebhookReconciliationRun,
    {
      key: webhookReconciliationKey,
      startedAt: runStartedAt,
    },
  )
  const deliveredSince =
    reconciliation.lastSuccessfulRedeliveryStartedAt ??
    runStartedAt - initialWebhookReconciliationLookbackMs

  try {
    const deliveryClient = await resolveWebhookDeliveryClient()
    const deliveries = await runGitHubBoundary(
      provideGitHubBoundary(
        withGitHubRetry(deliveryClient.listDeliveriesSince(deliveredSince)),
      ),
    )

    const deliveriesByGuid = new Map<string, typeof deliveries>()

    for (const delivery of deliveries) {
      const attempts = deliveriesByGuid.get(delivery.guid) ?? []
      deliveriesByGuid.set(delivery.guid, [...attempts, delivery])
    }

    const redeliveryCandidates = [...deliveriesByGuid.values()]
      .map((attempts) =>
        attempts.toSorted(
          (left, right) =>
            Date.parse(right.deliveredAt) - Date.parse(left.deliveredAt),
        ),
      )
      .filter((attempts) => !attempts.some((attempt) => attempt.status === 'OK'))
      .map((attempts) => attempts[0])

    for (const candidate of redeliveryCandidates) {
      await runGitHubBoundary(
        provideGitHubBoundary(
          withGitHubRetry(deliveryClient.redeliverDelivery(candidate.attemptId)),
        ),
      )
    }

    await ctx.runMutation(internal.github.completeWebhookReconciliationRun, {
      key: webhookReconciliationKey,
      completedAt: Date.now(),
      lastSuccessfulRedeliveryStartedAt: runStartedAt,
    })

    return {
      status: 'completed',
      scannedDeliveries: deliveries.length,
      redeliveredDeliveries: redeliveryCandidates.length,
    }
  } catch (error) {
    await ctx.runMutation(internal.github.failWebhookReconciliationRun, {
      key: webhookReconciliationKey,
      completedAt: Date.now(),
      errorMessage: readErrorMessage(error),
    })

    return {
      status: 'failed',
      scannedDeliveries: 0,
      redeliveredDeliveries: 0,
    }
  }
}

export const syncInstallationFromCallback = internalAction({
  args: {
    externalInstallationId: v.number(),
  },
  returns: v.object({
    githubInstallationId: v.string(),
    repositoryCount: v.number(),
  }),
  handler: (ctx, args) =>
    syncInstallationFromCallbackHandler(ctx, args.externalInstallationId),
})

export const verifyWebhookDelivery = internalAction({
  args: {
    deliveryId: v.string(),
    event: v.string(),
    payload: v.string(),
    signature256: v.string(),
  },
  returns: v.object({
    valid: v.boolean(),
    shouldQueue: v.boolean(),
    errorMessage: v.optional(v.string()),
  }),
  handler: (_ctx, args) => verifyWebhookDeliveryHandler(args),
})

export const processWebhookDelivery = internalAction({
  args: {
    deliveryRecordId: v.id('webhookDeliveries'),
  },
  returns: v.object({
    status: v.string(),
    commandCount: v.number(),
  }),
  handler: (ctx, args) => processWebhookDeliveryHandler(ctx, args),
})

export const reconcileWebhookDeliveries = internalAction({
  args: {},
  returns: v.object({
    status: v.string(),
    scannedDeliveries: v.number(),
    redeliveredDeliveries: v.number(),
  }),
  handler: (ctx) => reconcileWebhookDeliveriesHandler(ctx),
})
