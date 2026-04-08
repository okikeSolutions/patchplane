import { mutation, query } from './_generated/server'
import { v } from 'convex/values'
import { decodeExecutionTarget } from './contracts'
import {
  findExactExecutionTargetByKey,
  findExecutionTargetByKey,
} from './lib/configResolution'

export const upsert = mutation({
  args: {
    projectId: v.string(),
    key: v.string(),
    repositoryConnectionId: v.optional(v.id('repositories')),
    sandboxProvider: v.string(),
    runtimeProvider: v.string(),
    defaultBaseBranch: v.optional(v.string()),
    enabled: v.boolean(),
  },
  returns: v.id('executionTargets'),
  handler: async (ctx, args) => {
    const existing = await findExactExecutionTargetByKey(ctx.db, {
      projectId: args.projectId,
      key: args.key,
      repositoryConnectionId: args.repositoryConnectionId,
    })
    const now = Date.now()

    if (existing) {
      await ctx.db.patch('executionTargets', existing._id, {
        repositoryConnectionId: args.repositoryConnectionId,
        sandboxProvider: args.sandboxProvider,
        runtimeProvider: args.runtimeProvider,
        defaultBaseBranch: args.defaultBaseBranch,
        enabled: args.enabled,
        updatedAt: now,
      })

      return existing._id
    }

    return await ctx.db.insert('executionTargets', {
      projectId: args.projectId,
      key: args.key,
      repositoryConnectionId: args.repositoryConnectionId,
      sandboxProvider: args.sandboxProvider,
      runtimeProvider: args.runtimeProvider,
      defaultBaseBranch: args.defaultBaseBranch,
      enabled: args.enabled,
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const getByKey = query({
  args: {
    projectId: v.string(),
    key: v.string(),
    repositoryConnectionId: v.optional(v.id('repositories')),
  },
  returns: v.union(
    v.null(),
    v.object({
      id: v.string(),
      projectId: v.string(),
      key: v.string(),
      repositoryConnectionId: v.optional(v.string()),
      sandboxProvider: v.string(),
      runtimeProvider: v.string(),
      defaultBaseBranch: v.optional(v.string()),
      enabled: v.boolean(),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const executionTarget = await findExecutionTargetByKey(ctx.db, args)

    if (!executionTarget) {
      return null
    }

    const decoded = decodeExecutionTarget({
      id: String(executionTarget._id),
      projectId: executionTarget.projectId,
      key: executionTarget.key,
      repositoryConnectionId: executionTarget.repositoryConnectionId
        ? String(executionTarget.repositoryConnectionId)
        : undefined,
      sandboxProvider: executionTarget.sandboxProvider,
      runtimeProvider: executionTarget.runtimeProvider,
      defaultBaseBranch: executionTarget.defaultBaseBranch,
      enabled: executionTarget.enabled,
      createdAt: executionTarget.createdAt,
      updatedAt: executionTarget.updatedAt,
    })

    return decoded
  },
})

export const list = query({
  args: {
    projectId: v.string(),
  },
  returns: v.array(
    v.object({
      id: v.string(),
      projectId: v.string(),
      key: v.string(),
      repositoryConnectionId: v.optional(v.string()),
      sandboxProvider: v.string(),
      runtimeProvider: v.string(),
      defaultBaseBranch: v.optional(v.string()),
      enabled: v.boolean(),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const executionTargets = await ctx.db
      .query('executionTargets')
      .withIndex('by_project', (queryBuilder) =>
        queryBuilder.eq('projectId', args.projectId),
      )
      .collect()

    return executionTargets.map((executionTarget) =>
      decodeExecutionTarget({
        id: String(executionTarget._id),
        projectId: executionTarget.projectId,
        key: executionTarget.key,
        repositoryConnectionId: executionTarget.repositoryConnectionId
          ? String(executionTarget.repositoryConnectionId)
          : undefined,
        sandboxProvider: executionTarget.sandboxProvider,
        runtimeProvider: executionTarget.runtimeProvider,
        defaultBaseBranch: executionTarget.defaultBaseBranch,
        enabled: executionTarget.enabled,
        createdAt: executionTarget.createdAt,
        updatedAt: executionTarget.updatedAt,
      }),
    )
  },
})
