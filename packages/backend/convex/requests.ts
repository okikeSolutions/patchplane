import { mutation, query } from './_generated/server'
import { v } from 'convex/values'
import {
  decodePromptRequest,
  promptRequestSourceValidator,
  promptScopeValidator,
  workflowStatusValidator,
} from './contracts'
import { createPromptRequestFlow } from './lib/requestCreation'

export const create = mutation({
  args: {
    projectId: v.string(),
    executionTargetKey: v.string(),
    policyBundleKey: v.string(),
    createdByUserId: v.string(),
    prompt: v.string(),
    scope: promptScopeValidator,
  },
  returns: v.object({
    promptRequestId: v.id('promptRequests'),
    workflowRunId: v.id('workflowRuns'),
  }),
  handler: async (ctx, args) => {
    const { promptRequestId, workflowRunId } = await createPromptRequestFlow(
      ctx,
      {
        command: {
          kind: 'prompt_request.create',
          projectId: args.projectId,
          executionTargetKey: args.executionTargetKey,
          policyBundleKey: args.policyBundleKey,
          createdByUserId: args.createdByUserId,
          prompt: args.prompt,
          scope: args.scope,
          source: { kind: 'manual' },
        },
      },
    )

    return {
      promptRequestId,
      workflowRunId,
    }
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
        executionTargetId: String(request.executionTargetId),
        policyBundleId: String(request.policyBundleId),
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
