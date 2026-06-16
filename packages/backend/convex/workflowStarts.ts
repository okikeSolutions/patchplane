import type { UserIdentity } from 'convex/server'
import { ConvexError, v } from 'convex/values'
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'

function workOSOrganizationId(identity: UserIdentity) {
  const value =
    identity.organizationId ??
    identity.orgId ??
    identity.organization_id ??
    identity.org_id

  return typeof value === 'string' && value.length > 0 ? value : null
}

function requireWorkOSWorkspace(identity: UserIdentity, workspaceId: string) {
  const organizationId = workOSOrganizationId(identity)

  if (organizationId === null) {
    throw new ConvexError('Active WorkOS organization required')
  }

  if (workspaceId !== `workos:${organizationId}`) {
    throw new ConvexError('Workspace mismatch')
  }
}

async function requireWorkOSIdentity(ctx: {
  auth: { getUserIdentity(): Promise<UserIdentity | null> }
}) {
  const identity = await ctx.auth.getUserIdentity()

  if (identity === null) {
    throw new ConvexError('Authentication required')
  }

  return identity
}

function workspaceOrganizationId(workspaceId: string) {
  return workspaceId.startsWith('workos:')
    ? workspaceId.slice('workos:'.length)
    : null
}

async function requireMembershipPermission(
  ctx: QueryCtx | MutationCtx,
  identity: UserIdentity,
  workspaceId: string,
  permission: string,
) {
  const organizationId = workspaceOrganizationId(workspaceId)

  if (organizationId === null) {
    throw new ConvexError('WorkOS workspace required')
  }

  const membership = await ctx.db
    .query('memberships')
    .withIndex('by_auth_and_org', (q) =>
      q.eq('authId', identity.subject).eq('organizationId', organizationId),
    )
    .unique()

  if (membership === null || membership.status !== 'active') {
    throw new ConvexError('Active membership required')
  }

  if (!membership.permissions.includes(permission)) {
    throw new ConvexError('Permission required')
  }

  return membership
}

const workflowStartArgs = {
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
}

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

async function createWorkflowStartRecord(
  ctx: MutationCtx,
  args: {
    workspaceId: string
    actorId: string
    actorDisplayName: string
    source: 'dev' | 'app' | 'github_issue' | 'github_pr_comment'
    traceId: string
    prompt: string
  },
) {
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
}

export const createTrusted = internalMutation({
  args: workflowStartArgs,
  returns: workflowStartReturn,
  handler: createWorkflowStartRecord,
})

export const create = mutation({
  args: workflowStartArgs,
  returns: v.null(),
  handler: () => {
    throw new ConvexError('Use trusted workflow start boundary')
  },
})

export const listRecent = query({
  args: {
    workspaceId: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(workflowStartReturn),
  handler: async (ctx, args) => {
    const identity = await requireWorkOSIdentity(ctx)
    requireWorkOSWorkspace(identity, args.workspaceId)
    await requireMembershipPermission(
      ctx,
      identity,
      args.workspaceId,
      'workspace:view',
    )

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
