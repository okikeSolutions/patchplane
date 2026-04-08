import type { Id } from './_generated/dataModel'
import { mutation, query, type MutationCtx } from './_generated/server'
import { ConvexError, v } from 'convex/values'
import {
  decodePendingApproval,
  decodePendingInput,
  mergeDecisionStatusValidator,
  pendingApprovalResolutionStatusValidator,
  pendingApprovalStatusValidator,
  pendingInputResolutionStatusValidator,
  pendingInputStatusValidator,
} from './contracts'
import { ensurePromptRequestConfigReferences } from './lib/requestCreation'

function createGovernanceInvariantError(
  code:
    | 'GOVERNANCE_NOT_FOUND'
    | 'GOVERNANCE_INVALID_REFERENCE'
    | 'GOVERNANCE_INVALID_STATE',
  message: string,
  details: Record<string, unknown>,
) {
  return new ConvexError({
    code,
    message,
    ...details,
  })
}

async function assertWorkflowLineage(
  ctx: MutationCtx,
  args: {
    readonly promptRequestId: Id<'promptRequests'>
    readonly workflowRunId: Id<'workflowRuns'>
    readonly runtimeSessionId?: Id<'runtimeSessions'>
  },
) {
  const workflowRun = await ctx.db.get('workflowRuns', args.workflowRunId)

  if (!workflowRun) {
    throw createGovernanceInvariantError(
      'GOVERNANCE_NOT_FOUND',
      'Workflow run does not exist.',
      { workflowRunId: String(args.workflowRunId) },
    )
  }

  if (workflowRun.promptRequestId !== args.promptRequestId) {
    throw createGovernanceInvariantError(
      'GOVERNANCE_INVALID_REFERENCE',
      'Workflow run does not belong to the provided prompt request.',
      {
        workflowRunId: String(args.workflowRunId),
        promptRequestId: String(args.promptRequestId),
      },
    )
  }

  const promptRequest = await ctx.db.get('promptRequests', args.promptRequestId)

  if (!promptRequest) {
    throw createGovernanceInvariantError(
      'GOVERNANCE_NOT_FOUND',
      'Prompt request does not exist.',
      { promptRequestId: String(args.promptRequestId) },
    )
  }

  if (args.runtimeSessionId) {
    const runtimeSession = await ctx.db.get(
      'runtimeSessions',
      args.runtimeSessionId,
    )

    if (!runtimeSession) {
      throw createGovernanceInvariantError(
        'GOVERNANCE_NOT_FOUND',
        'Runtime session does not exist.',
        { runtimeSessionId: String(args.runtimeSessionId) },
      )
    }

    if (runtimeSession.workflowRunId !== args.workflowRunId) {
      throw createGovernanceInvariantError(
        'GOVERNANCE_INVALID_REFERENCE',
        'Runtime session does not belong to the provided workflow run.',
        {
          runtimeSessionId: String(args.runtimeSessionId),
          workflowRunId: String(args.workflowRunId),
        },
      )
    }
  }

  return {
    promptRequest,
    workflowRun,
  }
}

export const requestApproval = mutation({
  args: {
    promptRequestId: v.id('promptRequests'),
    workflowRunId: v.id('workflowRuns'),
    runtimeSessionId: v.optional(v.id('runtimeSessions')),
    kind: v.string(),
    title: v.string(),
    body: v.optional(v.string()),
    requestedByUserId: v.string(),
  },
  returns: v.id('pendingApprovals'),
  handler: async (ctx, args) => {
    await assertWorkflowLineage(ctx, args)
    const now = Date.now()

    return await ctx.db.insert('pendingApprovals', {
      ...args,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      resolvedByUserId: undefined,
      resolvedAt: undefined,
    })
  },
})

export const resolveApproval = mutation({
  args: {
    pendingApprovalId: v.id('pendingApprovals'),
    status: pendingApprovalResolutionStatusValidator,
    resolvedByUserId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const approval = await ctx.db.get(
      'pendingApprovals',
      args.pendingApprovalId,
    )

    if (!approval) {
      throw createGovernanceInvariantError(
        'GOVERNANCE_NOT_FOUND',
        'Pending approval does not exist.',
        { pendingApprovalId: String(args.pendingApprovalId) },
      )
    }

    if (approval.status !== 'pending') {
      throw createGovernanceInvariantError(
        'GOVERNANCE_INVALID_STATE',
        'Only pending approvals can be resolved.',
        {
          pendingApprovalId: String(args.pendingApprovalId),
          status: approval.status,
        },
      )
    }

    const now = Date.now()

    await ctx.db.patch('pendingApprovals', args.pendingApprovalId, {
      status: args.status,
      resolvedByUserId: args.resolvedByUserId,
      resolvedAt: now,
      updatedAt: now,
    })

    return null
  },
})

export const requestInput = mutation({
  args: {
    promptRequestId: v.id('promptRequests'),
    workflowRunId: v.id('workflowRuns'),
    runtimeSessionId: v.optional(v.id('runtimeSessions')),
    kind: v.string(),
    prompt: v.string(),
    requestedByUserId: v.string(),
  },
  returns: v.id('pendingInputs'),
  handler: async (ctx, args) => {
    await assertWorkflowLineage(ctx, args)
    const now = Date.now()

    return await ctx.db.insert('pendingInputs', {
      ...args,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      response: undefined,
      resolvedByUserId: undefined,
      resolvedAt: undefined,
    })
  },
})

export const resolveInput = mutation({
  args: {
    pendingInputId: v.id('pendingInputs'),
    status: pendingInputResolutionStatusValidator,
    response: v.optional(v.string()),
    resolvedByUserId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const pendingInput = await ctx.db.get('pendingInputs', args.pendingInputId)

    if (!pendingInput) {
      throw createGovernanceInvariantError(
        'GOVERNANCE_NOT_FOUND',
        'Pending input does not exist.',
        { pendingInputId: String(args.pendingInputId) },
      )
    }

    if (pendingInput.status !== 'pending') {
      throw createGovernanceInvariantError(
        'GOVERNANCE_INVALID_STATE',
        'Only pending inputs can be resolved.',
        {
          pendingInputId: String(args.pendingInputId),
          status: pendingInput.status,
        },
      )
    }

    if (args.status === 'resolved' && args.response === undefined) {
      throw createGovernanceInvariantError(
        'GOVERNANCE_INVALID_STATE',
        'Resolved inputs must include a response.',
        { pendingInputId: String(args.pendingInputId) },
      )
    }

    const now = Date.now()

    await ctx.db.patch('pendingInputs', args.pendingInputId, {
      status: args.status,
      response: args.response,
      resolvedByUserId: args.resolvedByUserId,
      resolvedAt: now,
      updatedAt: now,
    })

    return null
  },
})

export const recordMergeDecision = mutation({
  args: {
    workflowRunId: v.id('workflowRuns'),
    policyBundleId: v.optional(v.id('policyBundles')),
    status: mergeDecisionStatusValidator,
    reasons: v.array(v.string()),
    decidedByUserId: v.optional(v.string()),
  },
  returns: v.id('mergeDecisions'),
  handler: async (ctx, args) => {
    const workflowRun = await ctx.db.get('workflowRuns', args.workflowRunId)

    if (!workflowRun) {
      throw createGovernanceInvariantError(
        'GOVERNANCE_NOT_FOUND',
        'Workflow run does not exist.',
        { workflowRunId: String(args.workflowRunId) },
      )
    }

    const promptRequest = await ctx.db.get(
      'promptRequests',
      workflowRun.promptRequestId,
    )

    if (!promptRequest) {
      throw createGovernanceInvariantError(
        'GOVERNANCE_NOT_FOUND',
        'Prompt request does not exist for workflow run.',
        {
          workflowRunId: String(args.workflowRunId),
          promptRequestId: String(workflowRun.promptRequestId),
        },
      )
    }

    const resolvedConfig = await ensurePromptRequestConfigReferences(ctx, {
      promptRequestId: workflowRun.promptRequestId,
      projectId: promptRequest.projectId,
      repositoryConnectionId: workflowRun.repositoryConnectionId,
      executionTargetReference: String(promptRequest.executionTargetId),
      policyBundleReference: String(promptRequest.policyBundleId),
    })
    const policyBundleId =
      args.policyBundleId ?? resolvedConfig.policyBundle._id

    if (
      args.policyBundleId !== undefined &&
      args.policyBundleId !== resolvedConfig.policyBundle._id
    ) {
      throw createGovernanceInvariantError(
        'GOVERNANCE_INVALID_REFERENCE',
        'Merge decision policy bundle must match the workflow prompt request.',
        {
          workflowRunId: String(args.workflowRunId),
          policyBundleId: String(args.policyBundleId),
          expectedPolicyBundleId: String(resolvedConfig.policyBundle._id),
        },
      )
    }

    const now = Date.now()
    const decidedAt = args.status === 'pending' ? undefined : now
    const existing = await ctx.db
      .query('mergeDecisions')
      .withIndex('by_workflow_run_id', (queryBuilder) =>
        queryBuilder.eq('workflowRunId', args.workflowRunId),
      )
      .unique()

    if (existing) {
      await ctx.db.patch('mergeDecisions', existing._id, {
        policyBundleId,
        status: args.status,
        reasons: [...args.reasons],
        decidedByUserId: args.decidedByUserId,
        updatedAt: now,
        decidedAt,
      })

      return existing._id
    }

    return await ctx.db.insert('mergeDecisions', {
      workflowRunId: args.workflowRunId,
      policyBundleId,
      status: args.status,
      reasons: [...args.reasons],
      decidedByUserId: args.decidedByUserId,
      createdAt: now,
      updatedAt: now,
      decidedAt,
    })
  },
})

export const getMergeDecisionForWorkflowRun = query({
  args: {
    workflowRunId: v.id('workflowRuns'),
  },
  returns: v.union(
    v.null(),
    v.object({
      id: v.string(),
      workflowRunId: v.string(),
      policyBundleId: v.optional(v.string()),
      status: mergeDecisionStatusValidator,
      reasons: v.array(v.string()),
      decidedByUserId: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
      decidedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    const decision = await ctx.db
      .query('mergeDecisions')
      .withIndex('by_workflow_run_id', (queryBuilder) =>
        queryBuilder.eq('workflowRunId', args.workflowRunId),
      )
      .unique()

    if (!decision) {
      return null
    }

    return {
      id: String(decision._id),
      workflowRunId: String(decision.workflowRunId),
      policyBundleId: decision.policyBundleId
        ? String(decision.policyBundleId)
        : undefined,
      status: decision.status,
      reasons: [...decision.reasons],
      decidedByUserId: decision.decidedByUserId,
      createdAt: decision.createdAt,
      updatedAt: decision.updatedAt,
      decidedAt: decision.decidedAt,
    }
  },
})

export const listPendingApprovalsForWorkflowRun = query({
  args: {
    workflowRunId: v.id('workflowRuns'),
  },
  returns: v.array(
    v.object({
      id: v.string(),
      promptRequestId: v.string(),
      workflowRunId: v.string(),
      runtimeSessionId: v.optional(v.string()),
      kind: v.string(),
      title: v.string(),
      body: v.optional(v.string()),
      status: pendingApprovalStatusValidator,
      requestedByUserId: v.string(),
      resolvedByUserId: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
      resolvedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    const approvals = await ctx.db
      .query('pendingApprovals')
      .withIndex('by_workflow_run_id', (queryBuilder) =>
        queryBuilder.eq('workflowRunId', args.workflowRunId),
      )
      .order('desc')
      .collect()

    return approvals.map((approval) =>
      decodePendingApproval({
        id: String(approval._id),
        promptRequestId: String(approval.promptRequestId),
        workflowRunId: String(approval.workflowRunId),
        runtimeSessionId: approval.runtimeSessionId
          ? String(approval.runtimeSessionId)
          : undefined,
        kind: approval.kind,
        title: approval.title,
        body: approval.body,
        status: approval.status,
        requestedByUserId: approval.requestedByUserId,
        resolvedByUserId: approval.resolvedByUserId,
        createdAt: approval.createdAt,
        updatedAt: approval.updatedAt,
        resolvedAt: approval.resolvedAt,
      }),
    )
  },
})

export const listPendingInputsForWorkflowRun = query({
  args: {
    workflowRunId: v.id('workflowRuns'),
  },
  returns: v.array(
    v.object({
      id: v.string(),
      promptRequestId: v.string(),
      workflowRunId: v.string(),
      runtimeSessionId: v.optional(v.string()),
      kind: v.string(),
      prompt: v.string(),
      status: pendingInputStatusValidator,
      requestedByUserId: v.string(),
      response: v.optional(v.string()),
      resolvedByUserId: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
      resolvedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    const inputs = await ctx.db
      .query('pendingInputs')
      .withIndex('by_workflow_run_id', (queryBuilder) =>
        queryBuilder.eq('workflowRunId', args.workflowRunId),
      )
      .order('desc')
      .collect()

    return inputs.map((input) =>
      decodePendingInput({
        id: String(input._id),
        promptRequestId: String(input.promptRequestId),
        workflowRunId: String(input.workflowRunId),
        runtimeSessionId: input.runtimeSessionId
          ? String(input.runtimeSessionId)
          : undefined,
        kind: input.kind,
        prompt: input.prompt,
        status: input.status,
        requestedByUserId: input.requestedByUserId,
        response: input.response,
        resolvedByUserId: input.resolvedByUserId,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
        resolvedAt: input.resolvedAt,
      }),
    )
  },
})
