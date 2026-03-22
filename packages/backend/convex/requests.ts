import { mutation, query } from './_generated/server'
import { v } from 'convex/values'

const workflowStatus = v.union(
  v.literal('queued'),
  v.literal('running'),
  v.literal('reviewed'),
  v.literal('completed'),
  v.literal('failed'),
)

const promptScope = v.object({
  repoUrl: v.string(),
  baseBranch: v.string(),
  targetBranch: v.string(),
  includePaths: v.array(v.string()),
  excludePaths: v.array(v.string()),
  intent: v.string(),
})

export const create = mutation({
  args: {
    projectId: v.string(),
    executionTargetId: v.string(),
    policyBundleId: v.string(),
    createdByUserId: v.string(),
    prompt: v.string(),
    scope: promptScope,
  },
  returns: v.id('promptRequests'),
  handler: async (ctx, args) => {
    const now = Date.now()

    return await ctx.db.insert('promptRequests', {
      projectId: args.projectId,
      executionTargetId: args.executionTargetId,
      policyBundleId: args.policyBundleId,
      createdByUserId: args.createdByUserId,
      prompt: args.prompt,
      scope: args.scope,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const list = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id('promptRequests'),
      _creationTime: v.number(),
      projectId: v.string(),
      executionTargetId: v.string(),
      policyBundleId: v.string(),
      createdByUserId: v.string(),
      prompt: v.string(),
      scope: promptScope,
      status: workflowStatus,
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    return await ctx.db
      .query('promptRequests')
      .withIndex('by_created_at')
      .order('desc')
      .collect()
  },
})
