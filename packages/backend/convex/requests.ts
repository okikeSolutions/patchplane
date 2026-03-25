import { mutation, query } from './_generated/server'
import { v } from 'convex/values'
import {
  decodePromptRequest,
  promptRequestSourceValidator,
  promptScopeValidator,
  workflowStatusValidator,
} from './contracts'

export const create = mutation({
  args: {
    projectId: v.string(),
    executionTargetId: v.string(),
    policyBundleId: v.string(),
    createdByUserId: v.string(),
    prompt: v.string(),
    scope: promptScopeValidator,
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
      source: { kind: 'manual' },
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
      id: v.string(),
      projectId: v.string(),
      executionTargetId: v.string(),
      policyBundleId: v.string(),
      createdByUserId: v.string(),
      prompt: v.string(),
      scope: promptScopeValidator,
      source: promptRequestSourceValidator,
      status: workflowStatusValidator,
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const requests = await ctx.db
      .query('promptRequests')
      .withIndex('by_created_at')
      .order('desc')
      .collect()

    return requests.map((request) => {
      const decoded = decodePromptRequest({
        id: String(request._id),
        projectId: request.projectId,
        executionTargetId: request.executionTargetId,
        policyBundleId: request.policyBundleId,
        createdByUserId: request.createdByUserId,
        prompt: request.prompt,
        scope: request.scope,
        source: request.source,
        status: request.status,
        createdAt: request.createdAt,
        updatedAt: request.updatedAt,
      })

      return {
        ...decoded,
        scope: {
          ...decoded.scope,
          includePaths: [...decoded.scope.includePaths],
          excludePaths: [...decoded.scope.excludePaths],
        },
      }
    })
  },
})
