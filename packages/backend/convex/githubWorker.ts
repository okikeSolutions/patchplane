'use node'

import { Duration, Effect, Schedule } from 'effect'
import { internalAction } from './_generated/server'
import { anyApi } from 'convex/server'
import { v } from 'convex/values'
import {
  GitHubAppAuthService,
  GitHubWebhookDeliveryClientService,
  GitHubWebhookIngestorService,
} from '@patchplane/domain'
import { processPatchPlaneCommandsWithQueue } from '../src/github/commandQueue'
import { GitHubBoundaryLive } from '../src/github/layers'
import type { GitHubWebhookEnvelope } from '@patchplane/domain'

const webhookReconciliationKey = 'app_webhook_redelivery'
const initialWebhookReconciliationLookbackMs = 7 * 24 * 60 * 60 * 1000

function readErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Unknown GitHub worker failure.'
}

function runGitHubBoundary<A, E>(effect: Effect.Effect<A, E, any>) {
  return Effect.runPromise(Effect.provide(effect, GitHubBoundaryLive))
}

function withGitHubRetry<A, E>(
  effect: Effect.Effect<A, E, never>,
): Effect.Effect<A, E, never> {
  return Effect.retry(
    effect,
    Schedule.intersect(
      Schedule.exponential(Duration.seconds(1)),
      Schedule.recurs(3),
    ),
  )
}

function toWebhookEnvelope(delivery: {
  readonly deliveryId: string
  readonly event: string
  readonly action?: string
  readonly externalInstallationId?: number
  readonly externalRepositoryId?: number
  readonly repositoryFullName?: string
  readonly repositoryNodeId?: string
  readonly payload: string
  readonly receivedAt: number
}): GitHubWebhookEnvelope {
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

function syncInstallationFromCallbackProgram(
  ctx: Parameters<typeof syncInstallationFromCallback.handler>[0],
  externalInstallationId: number,
) {
  return Effect.gen(function* () {
    const auth = yield* GitHubAppAuthService
    const scope = yield* auth.resolveInstallationScope(externalInstallationId)

    const githubInstallationId = yield* Effect.promise(() =>
      ctx.runMutation(anyApi.github.upsertInstallationScope, {
        externalInstallationId: scope.externalInstallationId,
        accountLogin: scope.accountLogin,
        accountType: scope.accountType,
        targetType: scope.targetType,
        repositorySelection: scope.repositorySelection,
        permissions: scope.permissions,
        installedByUserId: undefined,
        syncedAt: scope.syncedAt,
      }),
    )

    yield* Effect.promise(() =>
      ctx.runMutation(anyApi.github.upsertRepositoryConnections, {
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
      }),
    )

    return {
      githubInstallationId: String(githubInstallationId),
      repositoryCount: scope.repositories.length,
    }
  })
}

function processWebhookDeliveryProgram(
  ctx: Parameters<typeof processWebhookDelivery.handler>[0],
  args: { readonly deliveryRecordId: string },
  delivery: NonNullable<
    Awaited<ReturnType<Parameters<typeof processWebhookDelivery.handler>[0]['runQuery']>>
  >,
) {
  return Effect.gen(function* () {
    const ingestor = yield* GitHubWebhookIngestorService
    const commands = yield* ingestor.ingest(
      toWebhookEnvelope({
        deliveryId: delivery.deliveryId,
        event: delivery.event,
        action: delivery.action,
        externalInstallationId: delivery.externalInstallationId,
        externalRepositoryId: delivery.externalRepositoryId,
        repositoryFullName: delivery.repositoryFullName,
        repositoryNodeId: delivery.repositoryNodeId,
        payload: delivery.payload,
        receivedAt: delivery.receivedAt,
      }),
    )

    if (commands.length === 0) {
      yield* Effect.promise(() =>
        ctx.runMutation(anyApi.github.markWebhookDeliveryOutcome, {
          deliveryRecordId: args.deliveryRecordId as any,
          status: 'ignored',
          commandEmitted: false,
          errorMessage: undefined,
        }),
      )

      return {
        status: 'ignored',
        commandCount: 0,
      } as const
    }

    yield* processPatchPlaneCommandsWithQueue(commands, (command) =>
      Effect.promise(() =>
        ctx.runMutation(anyApi.github.createPromptRequestFromCommand, {
          deliveryRecordId: args.deliveryRecordId as any,
          command,
        }),
      ),
    )

    return {
      status: 'accepted',
      commandCount: commands.length,
    } as const
  })
}

function reconcileWebhookDeliveriesProgram(
  ctx: Parameters<typeof reconcileWebhookDeliveries.handler>[0],
  runStartedAt: number,
  deliveredSince: number,
) {
  return Effect.gen(function* () {
    const webhookDeliveryClient = yield* GitHubWebhookDeliveryClientService
    const deliveries = yield* withGitHubRetry(
      webhookDeliveryClient.listDeliveriesSince(deliveredSince),
    )

    const deliveriesByGuid = new Map<string, typeof deliveries>()

    for (const delivery of deliveries) {
      const existingDeliveries = deliveriesByGuid.get(delivery.guid) ?? []
      deliveriesByGuid.set(delivery.guid, [...existingDeliveries, delivery])
    }

    const redeliveryCandidates = [...deliveriesByGuid.values()]
      .map((deliveryAttempts) =>
        deliveryAttempts.toSorted(
          (left, right) =>
            Date.parse(right.deliveredAt) - Date.parse(left.deliveredAt),
        ),
      )
      .filter(
        (deliveryAttempts) =>
          !deliveryAttempts.some((delivery) => delivery.status === 'OK'),
      )
      .map((deliveryAttempts) => deliveryAttempts[0])

    yield* Effect.forEach(
      redeliveryCandidates,
      (delivery) => withGitHubRetry(
        webhookDeliveryClient.redeliverDelivery(delivery.attemptId),
      ),
      { discard: true },
    )

    yield* Effect.promise(() =>
      ctx.runMutation(anyApi.github.completeWebhookReconciliationRun, {
        key: webhookReconciliationKey,
        completedAt: Date.now(),
        lastSuccessfulRedeliveryStartedAt: runStartedAt,
      }),
    )

    return {
      status: 'completed',
      scannedDeliveries: deliveries.length,
      redeliveredDeliveries: redeliveryCandidates.length,
    } as const
  })
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
    runGitHubBoundary(
      syncInstallationFromCallbackProgram(ctx, args.externalInstallationId),
    ),
})

export const processWebhookDelivery = internalAction({
  args: {
    deliveryRecordId: v.id('webhookDeliveries'),
  },
  returns: v.object({
    status: v.string(),
    commandCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const delivery = await ctx.runQuery(
      anyApi.github.getWebhookDeliveryForProcessing,
      {
        deliveryRecordId: args.deliveryRecordId,
      },
    )

    if (!delivery) {
      return {
        status: 'failed',
        commandCount: 0,
      }
    }

    if (!delivery.signatureVerified) {
      await ctx.runMutation(anyApi.github.markWebhookDeliveryOutcome, {
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
      return await runGitHubBoundary(
        processWebhookDeliveryProgram(
          ctx,
          { deliveryRecordId: args.deliveryRecordId as any },
          delivery,
        ),
      )
    } catch (error) {
      const errorMessage = readErrorMessage(error)

      await ctx.runMutation(anyApi.github.markWebhookDeliveryOutcome, {
        deliveryRecordId: args.deliveryRecordId,
        status: 'failed',
        commandEmitted: false,
        errorMessage,
      })

      return {
        status: 'failed',
        commandCount: 0,
      }
    }
  },
})

export const reconcileWebhookDeliveries = internalAction({
  args: {},
  returns: v.object({
    status: v.string(),
    scannedDeliveries: v.number(),
    redeliveredDeliveries: v.number(),
  }),
  handler: async (ctx) => {
    const runStartedAt = Date.now()
    const reconciliation = await ctx.runMutation(
      anyApi.github.beginWebhookReconciliationRun,
      {
        key: webhookReconciliationKey,
        startedAt: runStartedAt,
      },
    )
    const deliveredSince =
      reconciliation.lastSuccessfulRedeliveryStartedAt ??
      runStartedAt - initialWebhookReconciliationLookbackMs

    try {
      return await runGitHubBoundary(
        reconcileWebhookDeliveriesProgram(ctx, runStartedAt, deliveredSince),
      )
    } catch (error) {
      await ctx.runMutation(anyApi.github.failWebhookReconciliationRun, {
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
  },
})
