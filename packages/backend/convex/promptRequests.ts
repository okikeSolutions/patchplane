import { mutation } from './_generated/server'
import { v } from 'convex/values'

export const create = mutation({
  args: {
    workspaceId: v.string(),
    actorId: v.string(),
    actorDisplayName: v.string(),
    source: v.union(
      v.literal('dev'),
      v.literal('app'),
      v.literal('github_issue'),
      v.literal('github_pr_comment'),
    ),
    traceId: v.string(),
    prompt: v.string(),
  },
  returns: v.object({
    id: v.string(),
    workspaceId: v.string(),
    actorId: v.string(),
    traceId: v.string(),
    source: v.union(
      v.literal('dev'),
      v.literal('app'),
      v.literal('github_issue'),
      v.literal('github_pr_comment'),
    ),
    prompt: v.string(),
    status: v.literal('created'),
    createdAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const createdAt = Date.now()
    const status = 'created' as const
    const id = await ctx.db.insert('promptRequests', {
      workspaceId: args.workspaceId,
      actorId: args.actorId,
      actorDisplayName: args.actorDisplayName,
      traceId: args.traceId,
      source: args.source,
      prompt: args.prompt,
      status,
      createdAt,
    })

    return {
      id,
      workspaceId: args.workspaceId,
      actorId: args.actorId,
      traceId: args.traceId,
      source: args.source,
      prompt: args.prompt,
      status,
      createdAt,
    }
  },
})
