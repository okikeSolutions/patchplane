import { mutation } from './_generated/server'
import { v } from 'convex/values'

export const create = mutation({
  args: {
    promptRequestId: v.id('promptRequests'),
    workspaceId: v.string(),
    traceId: v.string(),
  },
  returns: v.object({
    id: v.string(),
    promptRequestId: v.string(),
    workspaceId: v.string(),
    traceId: v.string(),
    status: v.literal('queued'),
    createdAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const createdAt = Date.now()
    const status = 'queued' as const
    const id = await ctx.db.insert('workflowRuns', {
      promptRequestId: args.promptRequestId,
      workspaceId: args.workspaceId,
      traceId: args.traceId,
      status,
      createdAt,
    })

    return {
      id,
      promptRequestId: args.promptRequestId,
      workspaceId: args.workspaceId,
      traceId: args.traceId,
      status,
      createdAt,
    }
  },
})
