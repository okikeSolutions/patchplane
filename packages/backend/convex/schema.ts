import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  promptRequests: defineTable({
    workspaceId: v.string(),
    actorId: v.string(),
    actorDisplayName: v.string(),
    traceId: v.optional(v.string()),
    source: v.union(
      v.literal('dev'),
      v.literal('app'),
      v.literal('github_issue'),
      v.literal('github_pr_comment'),
    ),
    prompt: v.string(),
    status: v.literal('created'),
    createdAt: v.number(),
  })
    .index('by_workspace', ['workspaceId'])
    .index('by_actor', ['actorId'])
    .index('by_trace', ['traceId']),

  workflowRuns: defineTable({
    promptRequestId: v.id('promptRequests'),
    workspaceId: v.string(),
    traceId: v.optional(v.string()),
    status: v.union(
      v.literal('queued'),
      v.literal('running'),
      v.literal('reviewed'),
    ),
    createdAt: v.number(),
  })
    .index('by_prompt_request', ['promptRequestId'])
    .index('by_workspace', ['workspaceId'])
    .index('by_trace', ['traceId']),
})
