import { mutation, query } from './_generated/server'
import { v } from 'convex/values'
import {
  findExactPolicyBundleByKey,
  findPolicyBundleByKey,
} from './lib/configResolution'

export const upsert = mutation({
  args: {
    projectId: v.string(),
    key: v.string(),
    requiredReviewers: v.array(v.string()),
    minimumScore: v.number(),
    enabled: v.boolean(),
  },
  returns: v.id('policyBundles'),
  handler: async (ctx, args) => {
    const existing = await findExactPolicyBundleByKey(ctx.db, args)
    const now = Date.now()

    if (existing) {
      await ctx.db.patch('policyBundles', existing._id, {
        requiredReviewers: [...args.requiredReviewers],
        minimumScore: args.minimumScore,
        enabled: args.enabled,
        updatedAt: now,
      })

      return existing._id
    }

    return await ctx.db.insert('policyBundles', {
      projectId: args.projectId,
      key: args.key,
      requiredReviewers: [...args.requiredReviewers],
      minimumScore: args.minimumScore,
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
  },
  returns: v.union(
    v.null(),
    v.object({
      id: v.string(),
      projectId: v.string(),
      key: v.string(),
      requiredReviewers: v.array(v.string()),
      minimumScore: v.number(),
      enabled: v.boolean(),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const policyBundle = await findPolicyBundleByKey(ctx.db, args)

    if (!policyBundle) {
      return null
    }

    return {
      id: String(policyBundle._id),
      projectId: policyBundle.projectId,
      key: policyBundle.key,
      requiredReviewers: [...policyBundle.requiredReviewers],
      minimumScore: policyBundle.minimumScore,
      enabled: policyBundle.enabled,
      createdAt: policyBundle.createdAt,
      updatedAt: policyBundle.updatedAt,
    }
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
      requiredReviewers: v.array(v.string()),
      minimumScore: v.number(),
      enabled: v.boolean(),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const policyBundles = await ctx.db
      .query('policyBundles')
      .withIndex('by_project', (queryBuilder) =>
        queryBuilder.eq('projectId', args.projectId),
      )
      .collect()

    return policyBundles.map((policyBundle) => ({
      id: String(policyBundle._id),
      projectId: policyBundle.projectId,
      key: policyBundle.key,
      requiredReviewers: [...policyBundle.requiredReviewers],
      minimumScore: policyBundle.minimumScore,
      enabled: policyBundle.enabled,
      createdAt: policyBundle.createdAt,
      updatedAt: policyBundle.updatedAt,
    }))
  },
})
