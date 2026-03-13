import { mutation, query } from './_generated/server'
import { v } from 'convex/values'

export const create = mutation({
  args: {
    prompt: v.string(),
    repo: v.string(),
  },
  returns: v.id('promptRequests'),
  handler: async (ctx, args) => {
    return await ctx.db.insert('promptRequests', {
      prompt: args.prompt,
      repo: args.repo,
      status: 'queued',
      createdAt: Date.now(),
    })
  },
})

export const list = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id('promptRequests'),
      _creationTime: v.number(),
      prompt: v.string(),
      repo: v.string(),
      status: v.union(
        v.literal('queued'),
        v.literal('running'),
        v.literal('reviewed'),
        v.literal('completed'),
        v.literal('failed'),
      ),
      createdAt: v.number(),
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
