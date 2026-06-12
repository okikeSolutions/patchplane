import { query } from './_generated/server'
import { v } from 'convex/values'

export const list = query({
  args: {},
  returns: v.array(
    v.object({
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
  ),
  handler: async (ctx) => {
    const requests = await ctx.db.query('promptRequests').order('desc').take(50)

    return requests.map((request) => ({
      id: request['_id'],
      workspaceId: request.workspaceId,
      actorId: request.actorId,
      traceId: request.traceId ?? 'legacy',
      source: request.source,
      prompt: request.prompt,
      status: request.status,
      createdAt: request.createdAt,
    }))
  },
})
