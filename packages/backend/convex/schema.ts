import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  promptRequests: defineTable({
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
  }).index('by_created_at', ['createdAt']),
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
