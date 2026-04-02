'use node'

import { Duration, Effect, Schedule } from 'effect'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { internalAction, type ActionCtx } from './_generated/server'
import { v } from 'convex/values'
import {
  BoundaryFailure,
  type GitHubWebhookEnvelope,
  type PatchPlaneCommand,
} from '@patchplane/domain'
import {
  GitHubAppAuthService,
  GitHubWebhookDeliveryClientService,
  GitHubWebhookIngestorService,
} from '@patchplane/domain'
import { tryConvexPromise } from '../src/effect/convex'
import {
  readErrorMessage,
  type ConvexInteropFailure,
} from '../src/errors'
import { processPatchPlaneCommandsSequentially } from '../src/github/commandQueue'
import { GitHubAppRuntime, GitHubBoundaryLive } from '../src/github/layers'

const webhookReconciliationKey = 'app_webhook_redelivery'
const initialWebhookReconciliationLookbackMs = 7 * 24 * 60 * 60 * 1000
const gitHubRetrySchedule = Schedule.intersect(
  Schedule.exponential(Duration.seconds(1)),
  Schedule.recurs(3),
)

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

function withGitHubRetry<A>(
  effect: Effect.Effect<A, BoundaryFailure>,
): Effect.Effect<A, BoundaryFailure> {
  return Effect.retry(effect, {
    schedule: gitHubRetrySchedule,
    while: (error) => error.retryable,
  })
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

function markWebhookDeliveryOutcome(
  ctx: ActionCtx,
  deliveryRecordId: Id<'webhookDeliveries'>,
  outcome: {
    readonly status:
      | 'received'
      | 'queued'
      | 'accepted'
      | 'ignored'
      | 'duplicate'
      | 'failed'
    readonly commandEmitted: boolean
    readonly errorMessage?: string
  },
): Effect.Effect<void, ConvexInteropFailure> {
  return tryConvexPromise('mutation github.markWebhookDeliveryOutcome', () =>
    ctx.runMutation(internal.github.markWebhookDeliveryOutcome, {
      deliveryRecordId,
      ...outcome,
    }),
  ).pipe(Effect.map(() => undefined))
}

function createPromptRequestsFromCommands(
  ctx: ActionCtx,
  deliveryRecordId: Id<'webhookDeliveries'>,
  commands: ReadonlyArray<PatchPlaneCommand>,
): Effect.Effect<void, ConvexInteropFailure> {
  return processPatchPlaneCommandsSequentially(commands, (command) =>
    tryConvexPromise('mutation github.createPromptRequestFromCommand', () =>
      ctx.runMutation(internal.github.createPromptRequestFromCommand, {
        deliveryRecordId,
        command: toConvexPromptRequestCommand(command),
      }),
    ),
  ).pipe(Effect.map(() => undefined))
}

function syncInstallationFromCallbackProgram(
  ctx: ActionCtx,
  externalInstallationId: number,
) {
  return Effect.gen(function* () {
    const auth = yield* GitHubAppAuthService
    const scope = yield* auth.resolveInstallationScope(externalInstallationId)

    const githubInstallationId = yield* tryConvexPromise(
      'mutation github.upsertInstallationScope',
      () =>
        ctx.runMutation(internal.github.upsertInstallationScope, {
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

    yield* tryConvexPromise('mutation github.upsertRepositoryConnections', () =>
      ctx.runMutation(internal.github.upsertRepositoryConnections, {
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

function verifyWebhookDeliveryProgram(args: {
  readonly deliveryId: string
  readonly event: string
  readonly payload: string
  readonly signature256: string
}) {
  return Effect.gen(function* () {
    const app = yield* GitHubAppRuntime
    let shouldQueue = false

    app.webhooks.on('issue_comment.created', () => {
      shouldQueue = true
    })

    yield* Effect.tryPromise({
      try: () =>
        app.webhooks.verifyAndReceive({
          id: args.deliveryId,
          name: args.event,
          payload: args.payload,
          signature: args.signature256,
        }),
      catch: (cause) =>
        new BoundaryFailure({
          boundary: 'github.webhooks',
          message: `Failed to verify GitHub webhook delivery ${args.deliveryId}.`,
          retryable: false,
          cause,
        }),
    })

    return {
      valid: true,
      shouldQueue,
      errorMessage: undefined,
    }
  }).pipe(
    Effect.catchAll((error) =>
      Effect.succeed({
        valid: false,
        shouldQueue: false,
        errorMessage: readErrorMessage(error, 'Unknown GitHub worker failure.'),
      }),
    ),
  )
}

function processWebhookDeliveryProgram(
  ctx: ActionCtx,
  args: { readonly deliveryRecordId: Id<'webhookDeliveries'> },
) {
  return Effect.gen(function* () {
    const delivery = yield* tryConvexPromise(
      'query github.getWebhookDeliveryForProcessing',
      () =>
        ctx.runQuery(internal.github.getWebhookDeliveryForProcessing, {
          deliveryRecordId: args.deliveryRecordId,
        }),
    )

    if (!delivery) {
      return {
        status: 'failed',
        commandCount: 0,
      }
    }

    if (!delivery.signatureVerified) {
      yield* markWebhookDeliveryOutcome(ctx, args.deliveryRecordId, {
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

    return yield* Effect.gen(function* () {
      const ingestor = yield* GitHubWebhookIngestorService
      const commands = yield* ingestor.ingest(toWebhookEnvelope(delivery))

      if (commands.length === 0) {
        yield* markWebhookDeliveryOutcome(ctx, args.deliveryRecordId, {
          status: 'ignored',
          commandEmitted: false,
          errorMessage: undefined,
        })

        return {
          status: 'ignored',
          commandCount: 0,
        }
      }

      yield* createPromptRequestsFromCommands(
        ctx,
        args.deliveryRecordId,
        commands,
      )

      return {
        status: 'accepted',
        commandCount: commands.length,
      }
    }).pipe(
      Effect.catchAll((error) =>
        markWebhookDeliveryOutcome(ctx, args.deliveryRecordId, {
          status: 'failed',
          commandEmitted: false,
          errorMessage: readErrorMessage(
            error,
            'Unknown GitHub worker failure.',
          ),
        }).pipe(
          Effect.as({
            status: 'failed',
            commandCount: 0,
          }),
        ),
      ),
    )
  })
}

function reconcileWebhookDeliveriesProgram(
  ctx: ActionCtx,
) {
  const runStartedAt = Date.now()

  return Effect.gen(function* () {
    const reconciliation = yield* tryConvexPromise(
      'mutation github.beginWebhookReconciliationRun',
      () =>
        ctx.runMutation(internal.github.beginWebhookReconciliationRun, {
          key: webhookReconciliationKey,
          startedAt: runStartedAt,
        }),
    )
    const deliveredSince =
      reconciliation.lastSuccessfulRedeliveryStartedAt ??
      runStartedAt - initialWebhookReconciliationLookbackMs
    const deliveryClient = yield* GitHubWebhookDeliveryClientService

    return yield* Effect.gen(function* () {
      const deliveries = yield* withGitHubRetry(
        deliveryClient.listDeliveriesSince(deliveredSince),
      )

      const deliveriesByGuid = new Map<string, typeof deliveries>()

      for (const delivery of deliveries) {
        const attempts = deliveriesByGuid.get(delivery.guid) ?? []
        deliveriesByGuid.set(delivery.guid, [...attempts, delivery])
      }

      const redeliveryCandidates = [...deliveriesByGuid.values()]
        .map((attempts) =>
          [...attempts].sort(
            (left, right) =>
              Date.parse(right.deliveredAt) - Date.parse(left.deliveredAt),
          ),
        )
        .filter(
          (attempts) => !attempts.some((attempt) => attempt.status === 'OK'),
        )
        .map((attempts) => attempts[0])

      yield* Effect.forEach(redeliveryCandidates, (candidate) =>
        withGitHubRetry(deliveryClient.redeliverDelivery(candidate.attemptId)),
      )

      yield* tryConvexPromise(
        'mutation github.completeWebhookReconciliationRun',
        () =>
          ctx.runMutation(internal.github.completeWebhookReconciliationRun, {
            key: webhookReconciliationKey,
            completedAt: Date.now(),
            lastSuccessfulRedeliveryStartedAt: runStartedAt,
          }),
      )

      return {
        status: 'completed',
        scannedDeliveries: deliveries.length,
        redeliveredDeliveries: redeliveryCandidates.length,
      }
    }).pipe(
      Effect.catchAll((error) =>
        tryConvexPromise('mutation github.failWebhookReconciliationRun', () =>
          ctx.runMutation(internal.github.failWebhookReconciliationRun, {
            key: webhookReconciliationKey,
            completedAt: Date.now(),
            errorMessage: readErrorMessage(
              error,
              'Unknown GitHub worker failure.',
            ),
          }),
        ).pipe(
          Effect.as({
            status: 'failed',
            scannedDeliveries: 0,
            redeliveredDeliveries: 0,
          }),
        ),
      ),
    )
  })
}

async function syncInstallationFromCallbackHandler(
  ctx: ActionCtx,
  externalInstallationId: number,
): Promise<{
  readonly githubInstallationId: string
  readonly repositoryCount: number
}> {
  return Effect.runPromise(
    syncInstallationFromCallbackProgram(ctx, externalInstallationId).pipe(
      Effect.provide(GitHubBoundaryLive),
    ),
  )
}

async function processWebhookDeliveryHandler(
  ctx: ActionCtx,
  args: { readonly deliveryRecordId: Id<'webhookDeliveries'> },
): Promise<GitHubWorkerResult> {
  return Effect.runPromise(
    processWebhookDeliveryProgram(ctx, args).pipe(Effect.provide(GitHubBoundaryLive)),
  )
}

async function reconcileWebhookDeliveriesHandler(
  ctx: ActionCtx,
): Promise<ReconciliationResult> {
  return Effect.runPromise(
    reconcileWebhookDeliveriesProgram(ctx).pipe(Effect.provide(GitHubBoundaryLive)),
  )
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
  handler: (_ctx, args) =>
    Effect.runPromise(
      verifyWebhookDeliveryProgram(args).pipe(Effect.provide(GitHubBoundaryLive)),
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
