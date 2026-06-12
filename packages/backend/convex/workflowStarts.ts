import { mutation, query } from './_generated/server'
import { v } from 'convex/values'

const workflowStartReturn = v.object({
  promptRequest: v.object({
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
  workflowRun: v.object({
    id: v.string(),
    promptRequestId: v.string(),
    workspaceId: v.string(),
    traceId: v.string(),
    status: v.union(
      v.literal('queued'),
      v.literal('running'),
      v.literal('reviewed'),
    ),
    createdAt: v.number(),
  }),
})

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
  returns: workflowStartReturn,
  handler: async (ctx, args) => {
    const createdAt = Date.now()
    const promptRequestStatus = 'created' as const
    const workflowRunStatus = 'queued' as const

    const promptRequestId = await ctx.db.insert('promptRequests', {
      workspaceId: args.workspaceId,
      actorId: args.actorId,
      actorDisplayName: args.actorDisplayName,
      traceId: args.traceId,
      source: args.source,
      prompt: args.prompt,
      status: promptRequestStatus,
      createdAt,
    })

    const workflowRunId = await ctx.db.insert('workflowRuns', {
      promptRequestId,
      workspaceId: args.workspaceId,
      traceId: args.traceId,
      status: workflowRunStatus,
      createdAt,
    })

    console.log('workflowStarts:create succeeded', {
      traceId: args.traceId,
      promptRequestId,
      workflowRunId,
    })

    return {
      promptRequest: {
        id: promptRequestId,
        workspaceId: args.workspaceId,
        actorId: args.actorId,
        traceId: args.traceId,
        source: args.source,
        prompt: args.prompt,
        status: promptRequestStatus,
        createdAt,
      },
      workflowRun: {
        id: workflowRunId,
        promptRequestId,
        workspaceId: args.workspaceId,
        traceId: args.traceId,
        status: workflowRunStatus,
        createdAt,
      },
    }
  },
})

export const listRecent = query({
  args: {
    workspaceId: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(workflowStartReturn),
  handler: async (ctx, args) => {
    const workflowRuns = await ctx.db
      .query('workflowRuns')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', args.workspaceId))
      .order('desc')
      .take(args.limit ?? 10)

    const workflowStarts = []

    for (const workflowRun of workflowRuns) {
      const promptRequest = await ctx.db.get(
        'promptRequests',
        workflowRun.promptRequestId,
      )
      if (promptRequest === null) {
        continue
      }

      workflowStarts.push({
        promptRequest: {
          id: promptRequest['_id'],
          workspaceId: promptRequest.workspaceId,
          actorId: promptRequest.actorId,
          traceId: promptRequest.traceId ?? 'legacy',
          source: promptRequest.source,
          prompt: promptRequest.prompt,
          status: promptRequest.status,
          createdAt: promptRequest.createdAt,
        },
        workflowRun: {
          id: workflowRun['_id'],
          promptRequestId: workflowRun.promptRequestId,
          workspaceId: workflowRun.workspaceId,
          traceId: workflowRun.traceId ?? 'legacy',
          status: workflowRun.status,
          createdAt: workflowRun.createdAt,
        },
      })
    }

    return workflowStarts
  },
})
