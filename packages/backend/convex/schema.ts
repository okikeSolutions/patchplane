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
      v.literal('external'),
    ),
    prompt: v.string(),
    externalRef: v.optional(
      v.object({
        provider: v.string(),
        deliveryId: v.string(),
        eventKind: v.string(),
        repositoryProvider: v.optional(v.string()),
        repositoryInstallationId: v.optional(v.string()),
        repositoryExternalId: v.optional(v.string()),
        repositoryOwner: v.optional(v.string()),
        repositoryName: v.optional(v.string()),
        repositoryFullName: v.optional(v.string()),
        issueExternalId: v.optional(v.string()),
        issueNumber: v.optional(v.number()),
        issueTitle: v.optional(v.string()),
        commentExternalId: v.optional(v.string()),
        url: v.optional(v.string()),
        senderProvider: v.optional(v.string()),
        senderExternalId: v.optional(v.string()),
        senderLogin: v.optional(v.string()),
      }),
    ),
    status: v.literal('created'),
    createdAt: v.number(),
  })
    .index('by_workspace', ['workspaceId'])
    .index('by_actor', ['actorId'])
    .index('by_trace', ['traceId']),

  externalWorkflowRefs: defineTable({
    provider: v.string(),
    deliveryId: v.string(),
    eventKind: v.string(),
    repositoryProvider: v.optional(v.string()),
    repositoryInstallationId: v.optional(v.string()),
    repositoryExternalId: v.optional(v.string()),
    repositoryOwner: v.optional(v.string()),
    repositoryName: v.optional(v.string()),
    repositoryFullName: v.optional(v.string()),
    issueExternalId: v.optional(v.string()),
    issueNumber: v.optional(v.number()),
    issueTitle: v.optional(v.string()),
    commentExternalId: v.optional(v.string()),
    url: v.optional(v.string()),
    senderProvider: v.optional(v.string()),
    senderExternalId: v.optional(v.string()),
    senderLogin: v.optional(v.string()),
    promptRequestId: v.id('promptRequests'),
    workflowRunId: v.id('workflowRuns'),
    createdAt: v.number(),
  })
    .index('by_delivery', ['provider', 'deliveryId'])
    .index('by_issue_event', [
      'provider',
      'repositoryExternalId',
      'issueExternalId',
      'eventKind',
    ])
    .index('by_comment', ['provider', 'commentExternalId']),

  runtimeEvents: defineTable({
    workflowRunId: v.id('workflowRuns'),
    provider: v.string(),
    type: v.string(),
    occurredAt: v.number(),
    summary: v.optional(v.string()),
    payloadJson: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_workflow_run', ['workflowRunId'])
    .index('by_type', ['provider', 'type']),

  sandboxExecutions: defineTable({
    workflowRunId: v.id('workflowRuns'),
    provider: v.string(),
    sandboxId: v.string(),
    command: v.string(),
    status: v.union(v.literal('succeeded'), v.literal('failed')),
    exitCode: v.optional(v.number()),
    stdout: v.string(),
    stderr: v.optional(v.string()),
    policyJson: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.number(),
    createdAt: v.number(),
  }).index('by_workflow_run', ['workflowRunId']),

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
