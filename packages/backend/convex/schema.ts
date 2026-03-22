import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

const workflowStatus = v.union(
  v.literal('queued'),
  v.literal('running'),
  v.literal('reviewed'),
  v.literal('completed'),
  v.literal('failed'),
)

export default defineSchema({
  promptRequests: defineTable({
    projectId: v.string(),
    executionTargetId: v.string(),
    policyBundleId: v.string(),
    createdByUserId: v.string(),
    prompt: v.string(),
    scope: v.object({
      repoUrl: v.string(),
      baseBranch: v.string(),
      targetBranch: v.string(),
      includePaths: v.array(v.string()),
      excludePaths: v.array(v.string()),
      intent: v.string(),
    }),
    status: workflowStatus,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_created_at', ['createdAt'])
    .index('by_project', ['projectId']),
  runtimeEvents: defineTable({
    requestId: v.id('promptRequests'),
    type: v.string(),
    message: v.string(),
    createdAt: v.number(),
  }).index('by_request', ['requestId']),
  reviewRuns: defineTable({
    requestId: v.id('promptRequests'),
    reviewer: v.string(),
    score: v.number(),
    passed: v.boolean(),
    summary: v.string(),
  }).index('by_request', ['requestId']),
})
