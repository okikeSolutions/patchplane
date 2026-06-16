import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  users: defineTable({
    authId: v.string(),
    email: v.string(),
    name: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    deletedAt: v.optional(v.number()),
    status: v.union(v.literal('active'), v.literal('deleted')),
    updatedAt: v.number(),
  }).index('by_auth_id', ['authId']),

  memberships: defineTable({
    workosMembershipId: v.string(),
    authId: v.string(),
    organizationId: v.string(),
    status: v.union(
      v.literal('active'),
      v.literal('inactive'),
      v.literal('pending'),
      v.literal('deleted'),
    ),
    role: v.string(),
    roles: v.array(v.string()),
    permissions: v.array(v.string()),
    deletedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index('by_workos_membership_id', ['workosMembershipId'])
    .index('by_auth_and_org', ['authId', 'organizationId']),

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
