import { internalMutation, internalQuery, query } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { v } from 'convex/values'
import {
  decodeGitHubWebhookReconciliationState,
  decodeGitHubInstallation,
  decodePromptRequestCommand,
  decodeWorkflowRun,
  githubAccountTypeValidator,
  githubInstallationStatusValidator,
  githubReconciliationStatusValidator,
  githubRepositorySelectionValidator,
  githubWebhookDeliveryStatusValidator,
  promptRequestCommandValidator,
  workflowRunStatusValidator,
} from './contracts'
import { createPromptRequestFlow } from './lib/requestCreation'

export const recordInstallationCallback = internalMutation({
  args: {
    externalInstallationId: v.number(),
    setupAction: v.optional(v.string()),
    setupState: v.optional(v.string()),
  },
  returns: v.id('githubInstallations'),
  handler: async (ctx, args) => {
    const now = Date.now()
    const existing = await ctx.db
      .query('githubInstallations')
      .withIndex('by_external_installation_id', (queryBuilder) =>
        queryBuilder.eq('externalInstallationId', args.externalInstallationId),
      )
      .unique()

    if (existing) {
      await ctx.db.patch('githubInstallations', existing._id, {
        setupAction: args.setupAction,
        setupState: args.setupState,
        status: 'pending',
        updatedAt: now,
      })

      return existing._id
    }

    return await ctx.db.insert('githubInstallations', {
      externalInstallationId: args.externalInstallationId,
      accountLogin: '',
      accountType: 'Organization',
      targetType: 'Organization',
      repositorySelection: 'selected',
      permissions: {},
      status: 'pending',
      setupAction: args.setupAction,
      setupState: args.setupState,
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const upsertInstallationScope = internalMutation({
  args: {
    externalInstallationId: v.number(),
    accountLogin: v.string(),
    accountType: githubAccountTypeValidator,
    targetType: githubAccountTypeValidator,
    repositorySelection: githubRepositorySelectionValidator,
    permissions: v.record(v.string(), v.string()),
    installedByUserId: v.optional(v.string()),
    syncedAt: v.number(),
  },
  returns: v.id('githubInstallations'),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('githubInstallations')
      .withIndex('by_external_installation_id', (queryBuilder) =>
        queryBuilder.eq('externalInstallationId', args.externalInstallationId),
      )
      .unique()

    if (existing) {
      await ctx.db.patch('githubInstallations', existing._id, {
        accountLogin: args.accountLogin,
        accountType: args.accountType,
        targetType: args.targetType,
        repositorySelection: args.repositorySelection,
        permissions: args.permissions,
        installedByUserId: args.installedByUserId,
        status: 'active',
        lastSyncedAt: args.syncedAt,
        updatedAt: args.syncedAt,
      })

      return existing._id
    }

    return await ctx.db.insert('githubInstallations', {
      externalInstallationId: args.externalInstallationId,
      accountLogin: args.accountLogin,
      accountType: args.accountType,
      targetType: args.targetType,
      repositorySelection: args.repositorySelection,
      permissions: args.permissions,
      installedByUserId: args.installedByUserId,
      status: 'active',
      lastSyncedAt: args.syncedAt,
      createdAt: args.syncedAt,
      updatedAt: args.syncedAt,
    })
  },
})

export const upsertRepositoryConnections = internalMutation({
  args: {
    githubInstallationId: v.id('githubInstallations'),
    repositories: v.array(
      v.object({
        externalRepositoryId: v.number(),
        externalNodeId: v.string(),
        fullName: v.string(),
        owner: v.string(),
        name: v.string(),
        defaultBranch: v.string(),
        isPrivate: v.boolean(),
        isArchived: v.boolean(),
        isDisabled: v.boolean(),
      }),
    ),
    syncedAt: v.number(),
  },
  returns: v.array(v.id('repositories')),
  handler: async (ctx, args) => {
    const repositoryIds = []

    for (const repository of args.repositories) {
      const existing = await ctx.db
        .query('repositories')
        .withIndex('by_external_repository_id', (queryBuilder) =>
          queryBuilder.eq(
            'externalRepositoryId',
            repository.externalRepositoryId,
          ),
        )
        .unique()

      if (existing) {
        await ctx.db.patch('repositories', existing._id, {
          githubInstallationId: args.githubInstallationId,
          fullName: repository.fullName,
          owner: repository.owner,
          name: repository.name,
          defaultBranch: repository.defaultBranch,
          isPrivate: repository.isPrivate,
          isArchived: repository.isArchived,
          isDisabled: repository.isDisabled,
          lastSyncedAt: args.syncedAt,
          updatedAt: args.syncedAt,
        })
        repositoryIds.push(existing._id)
        continue
      }

      const repositoryId = await ctx.db.insert('repositories', {
        githubInstallationId: args.githubInstallationId,
        provider: 'github',
        externalRepositoryId: repository.externalRepositoryId,
        externalNodeId: repository.externalNodeId,
        fullName: repository.fullName,
        owner: repository.owner,
        name: repository.name,
        defaultBranch: repository.defaultBranch,
        isPrivate: repository.isPrivate,
        isArchived: repository.isArchived,
        isDisabled: repository.isDisabled,
        lastSyncedAt: args.syncedAt,
        createdAt: args.syncedAt,
        updatedAt: args.syncedAt,
      })
      repositoryIds.push(repositoryId)
    }

    return repositoryIds
  },
})

export const recordWebhookDelivery = internalMutation({
  args: {
    deliveryId: v.string(),
    event: v.string(),
    action: v.optional(v.string()),
    externalInstallationId: v.optional(v.number()),
    externalRepositoryId: v.optional(v.number()),
    repositoryFullName: v.optional(v.string()),
    repositoryNodeId: v.optional(v.string()),
    signatureVerified: v.boolean(),
    payload: v.string(),
    receivedAt: v.number(),
  },
  returns: v.object({
    deliveryRecordId: v.id('webhookDeliveries'),
    duplicate: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('webhookDeliveries')
      .withIndex('by_delivery_id', (queryBuilder) =>
        queryBuilder.eq('deliveryId', args.deliveryId),
      )
      .unique()

    if (existing) {
      if (existing.status === 'failed') {
        await ctx.db.patch('webhookDeliveries', existing._id, {
          event: args.event,
          action: args.action,
          externalInstallationId: args.externalInstallationId,
          externalRepositoryId: args.externalRepositoryId,
          repositoryFullName: args.repositoryFullName,
          repositoryNodeId: args.repositoryNodeId,
          status: 'received',
          signatureVerified: args.signatureVerified,
          commandEmitted: false,
          payload: args.payload,
          receivedAt: args.receivedAt,
          processedAt: undefined,
          errorMessage: undefined,
        })

        return {
          deliveryRecordId: existing._id,
          duplicate: false,
        }
      }

      return {
        deliveryRecordId: existing._id,
        duplicate: true,
      }
    }

    const deliveryRecordId = await ctx.db.insert('webhookDeliveries', {
      deliveryId: args.deliveryId,
      event: args.event,
      action: args.action,
      externalInstallationId: args.externalInstallationId,
      externalRepositoryId: args.externalRepositoryId,
      repositoryFullName: args.repositoryFullName,
      repositoryNodeId: args.repositoryNodeId,
      status: 'received',
      signatureVerified: args.signatureVerified,
      commandEmitted: false,
      payload: args.payload,
      receivedAt: args.receivedAt,
    })

    return {
      deliveryRecordId,
      duplicate: false,
    }
  },
})

export const queueWebhookDelivery = internalMutation({
  args: {
    deliveryRecordId: v.id('webhookDeliveries'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch('webhookDeliveries', args.deliveryRecordId, {
      status: 'queued',
      signatureVerified: true,
    })

    return null
  },
})

export const markWebhookDeliveryOutcome = internalMutation({
  args: {
    deliveryRecordId: v.id('webhookDeliveries'),
    status: githubWebhookDeliveryStatusValidator,
    commandEmitted: v.boolean(),
    promptRequestId: v.optional(v.id('promptRequests')),
    workflowRunId: v.optional(v.id('workflowRuns')),
    errorMessage: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch('webhookDeliveries', args.deliveryRecordId, {
      status: args.status,
      commandEmitted: args.commandEmitted,
      promptRequestId: args.promptRequestId,
      workflowRunId: args.workflowRunId,
      processedAt: Date.now(),
      errorMessage: args.errorMessage,
    })

    return null
  },
})

export const createPromptRequestFromCommand = internalMutation({
  args: {
    deliveryRecordId: v.optional(v.id('webhookDeliveries')),
    command: promptRequestCommandValidator,
  },
  returns: v.object({
    promptRequestId: v.id('promptRequests'),
    workflowRunId: v.id('workflowRuns'),
  }),
  handler: async (ctx, args) => {
    const command = decodePromptRequestCommand(args.command)
    const now = Date.now()

    let githubInstallationId: Id<'githubInstallations'> | undefined
    let repositoryConnectionId: Id<'repositories'> | undefined

    if (command.source.kind === 'github.issue_comment') {
      const githubSource = command.source
      const existingInstallation = await ctx.db
        .query('githubInstallations')
        .withIndex('by_external_installation_id', (queryBuilder) =>
          queryBuilder.eq(
            'externalInstallationId',
            githubSource.externalInstallationId,
          ),
        )
        .unique()

      if (!existingInstallation) {
        throw new Error(
          `No authoritative GitHub installation exists for external installation ${githubSource.externalInstallationId}. Sync the installation before accepting webhook commands.`,
        )
      }

      githubInstallationId = existingInstallation._id

      const existingRepository = await ctx.db
        .query('repositories')
        .withIndex('by_external_repository_id', (queryBuilder) =>
          queryBuilder.eq(
            'externalRepositoryId',
            githubSource.externalRepositoryId,
          ),
        )
        .unique()

      if (!existingRepository) {
        throw new Error(
          `No authoritative repository record exists for external repository ${githubSource.externalRepositoryId}. Sync the repository before accepting webhook commands.`,
        )
      }

      if (existingRepository.githubInstallationId !== githubInstallationId) {
        throw new Error(
          `Repository ${githubSource.repositoryFullName} is not bound to installation ${githubSource.externalInstallationId}.`,
        )
      }

      repositoryConnectionId = existingRepository._id
    }

    const { promptRequestId, workflowRunId } = await createPromptRequestFlow(
      ctx,
      {
        command,
        githubInstallationId,
        repositoryConnectionId,
      },
    )

    if (args.deliveryRecordId) {
      await ctx.db.patch('webhookDeliveries', args.deliveryRecordId, {
        status: 'accepted',
        commandEmitted: true,
        promptRequestId,
        workflowRunId,
        processedAt: now,
      })
    }

    return {
      promptRequestId,
      workflowRunId,
    }
  },
})

export const getWebhookDeliveryForProcessing = internalQuery({
  args: {
    deliveryRecordId: v.id('webhookDeliveries'),
  },
  returns: v.union(
    v.object({
      id: v.string(),
      deliveryId: v.string(),
      event: v.string(),
      action: v.optional(v.string()),
      externalInstallationId: v.optional(v.number()),
      externalRepositoryId: v.optional(v.number()),
      repositoryFullName: v.optional(v.string()),
      repositoryNodeId: v.optional(v.string()),
      status: githubWebhookDeliveryStatusValidator,
      signatureVerified: v.boolean(),
      commandEmitted: v.boolean(),
      payload: v.string(),
      promptRequestId: v.optional(v.string()),
      workflowRunId: v.optional(v.string()),
      receivedAt: v.number(),
      processedAt: v.optional(v.number()),
      errorMessage: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(
      'webhookDeliveries',
      args.deliveryRecordId,
    )

    if (!delivery) {
      return null
    }

    return {
      id: String(delivery._id),
      deliveryId: delivery.deliveryId,
      event: delivery.event,
      action: delivery.action,
      externalInstallationId: delivery.externalInstallationId,
      externalRepositoryId: delivery.externalRepositoryId,
      repositoryFullName: delivery.repositoryFullName,
      repositoryNodeId: delivery.repositoryNodeId,
      status: delivery.status,
      signatureVerified: delivery.signatureVerified,
      commandEmitted: delivery.commandEmitted,
      payload: delivery.payload,
      promptRequestId: delivery.promptRequestId
        ? String(delivery.promptRequestId)
        : undefined,
      workflowRunId: delivery.workflowRunId
        ? String(delivery.workflowRunId)
        : undefined,
      receivedAt: delivery.receivedAt,
      processedAt: delivery.processedAt,
      errorMessage: delivery.errorMessage,
    }
  },
})

export const beginWebhookReconciliationRun = internalMutation({
  args: {
    key: v.string(),
    startedAt: v.number(),
  },
  returns: v.object({
    lastSuccessfulRedeliveryStartedAt: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('githubWebhookReconciliationStates')
      .withIndex('by_key', (queryBuilder) => queryBuilder.eq('key', args.key))
      .unique()

    if (existing) {
      await ctx.db.patch('githubWebhookReconciliationStates', existing._id, {
        lastRunStartedAt: args.startedAt,
        lastRunStatus: 'running',
        lastErrorMessage: undefined,
        updatedAt: args.startedAt,
      })

      return {
        lastSuccessfulRedeliveryStartedAt:
          existing.lastSuccessfulRedeliveryStartedAt,
      }
    }

    await ctx.db.insert('githubWebhookReconciliationStates', {
      key: args.key,
      lastSuccessfulRedeliveryStartedAt: undefined,
      lastRunStartedAt: args.startedAt,
      lastRunCompletedAt: undefined,
      lastRunStatus: 'running',
      lastErrorMessage: undefined,
      updatedAt: args.startedAt,
    })

    return {
      lastSuccessfulRedeliveryStartedAt: undefined,
    }
  },
})

export const completeWebhookReconciliationRun = internalMutation({
  args: {
    key: v.string(),
    completedAt: v.number(),
    lastSuccessfulRedeliveryStartedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('githubWebhookReconciliationStates')
      .withIndex('by_key', (queryBuilder) => queryBuilder.eq('key', args.key))
      .unique()

    if (existing) {
      await ctx.db.patch('githubWebhookReconciliationStates', existing._id, {
        lastSuccessfulRedeliveryStartedAt:
          args.lastSuccessfulRedeliveryStartedAt,
        lastRunCompletedAt: args.completedAt,
        lastRunStatus: 'completed',
        lastErrorMessage: undefined,
        updatedAt: args.completedAt,
      })
    } else {
      await ctx.db.insert('githubWebhookReconciliationStates', {
        key: args.key,
        lastSuccessfulRedeliveryStartedAt:
          args.lastSuccessfulRedeliveryStartedAt,
        lastRunStartedAt: args.lastSuccessfulRedeliveryStartedAt,
        lastRunCompletedAt: args.completedAt,
        lastRunStatus: 'completed',
        lastErrorMessage: undefined,
        updatedAt: args.completedAt,
      })
    }

    return null
  },
})

export const failWebhookReconciliationRun = internalMutation({
  args: {
    key: v.string(),
    completedAt: v.number(),
    errorMessage: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('githubWebhookReconciliationStates')
      .withIndex('by_key', (queryBuilder) => queryBuilder.eq('key', args.key))
      .unique()

    if (existing) {
      await ctx.db.patch('githubWebhookReconciliationStates', existing._id, {
        lastRunCompletedAt: args.completedAt,
        lastRunStatus: 'failed',
        lastErrorMessage: args.errorMessage,
        updatedAt: args.completedAt,
      })
    } else {
      await ctx.db.insert('githubWebhookReconciliationStates', {
        key: args.key,
        lastSuccessfulRedeliveryStartedAt: undefined,
        lastRunStartedAt: undefined,
        lastRunCompletedAt: args.completedAt,
        lastRunStatus: 'failed',
        lastErrorMessage: args.errorMessage,
        updatedAt: args.completedAt,
      })
    }

    return null
  },
})

export const getWebhookReconciliationState = query({
  args: {
    key: v.string(),
  },
  returns: v.union(
    v.object({
      id: v.string(),
      key: v.string(),
      lastSuccessfulRedeliveryStartedAt: v.optional(v.number()),
      lastRunStartedAt: v.optional(v.number()),
      lastRunCompletedAt: v.optional(v.number()),
      lastRunStatus: githubReconciliationStatusValidator,
      lastErrorMessage: v.optional(v.string()),
      updatedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query('githubWebhookReconciliationStates')
      .withIndex('by_key', (queryBuilder) => queryBuilder.eq('key', args.key))
      .unique()

    if (!state) {
      return null
    }

    return decodeGitHubWebhookReconciliationState({
      id: String(state._id),
      key: state.key,
      lastSuccessfulRedeliveryStartedAt:
        state.lastSuccessfulRedeliveryStartedAt,
      lastRunStartedAt: state.lastRunStartedAt,
      lastRunCompletedAt: state.lastRunCompletedAt,
      lastRunStatus: state.lastRunStatus,
      lastErrorMessage: state.lastErrorMessage,
      updatedAt: state.updatedAt,
    })
  },
})

export const listInstallations = query({
  args: {},
  returns: v.array(
    v.object({
      id: v.string(),
      externalInstallationId: v.number(),
      accountLogin: v.string(),
      accountType: githubAccountTypeValidator,
      targetType: githubAccountTypeValidator,
      repositorySelection: githubRepositorySelectionValidator,
      permissions: v.record(v.string(), v.string()),
      status: githubInstallationStatusValidator,
      setupAction: v.optional(v.string()),
      setupState: v.optional(v.string()),
      installedByUserId: v.optional(v.string()),
      lastSyncedAt: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const installations = await ctx.db
      .query('githubInstallations')
      .order('desc')
      .collect()

    return installations.map((installation) =>
      decodeGitHubInstallation({
        id: String(installation._id),
        externalInstallationId: installation.externalInstallationId,
        accountLogin: installation.accountLogin,
        accountType: installation.accountType,
        targetType: installation.targetType,
        repositorySelection: installation.repositorySelection,
        permissions: installation.permissions,
        status: installation.status,
        setupAction: installation.setupAction,
        setupState: installation.setupState,
        installedByUserId: installation.installedByUserId,
        lastSyncedAt: installation.lastSyncedAt,
        createdAt: installation.createdAt,
        updatedAt: installation.updatedAt,
      }),
    )
  },
})

export const listWorkflowRuns = query({
  args: {},
  returns: v.array(
    v.object({
      id: v.string(),
      promptRequestId: v.string(),
      githubInstallationId: v.optional(v.string()),
      repositoryConnectionId: v.optional(v.string()),
      sandboxProvider: v.string(),
      runtimeProvider: v.string(),
      status: workflowRunStatusValidator,
      createdAt: v.number(),
      updatedAt: v.number(),
      startedAt: v.optional(v.number()),
      completedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx) => {
    const runs = await ctx.db.query('workflowRuns').order('desc').collect()

    return runs.map((run) =>
      decodeWorkflowRun({
        id: String(run._id),
        promptRequestId: String(run.promptRequestId),
        githubInstallationId: run.githubInstallationId
          ? String(run.githubInstallationId)
          : undefined,
        repositoryConnectionId: run.repositoryConnectionId
          ? String(run.repositoryConnectionId)
          : undefined,
        sandboxProvider: run.sandboxProvider,
        runtimeProvider: run.runtimeProvider,
        status: run.status,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
      }),
    )
  },
})
