import { internalMutation, query } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { v } from 'convex/values'
import {
  mergeDecisionStatusValidator,
  pendingApprovalStatusValidator,
  pendingInputStatusValidator,
  promptScopeValidator,
  runtimeEventTypeValidator,
  runtimeProviderEventStreamValidator,
  runtimeSessionStatusValidator,
  workflowRunStatusValidator,
} from './contracts'
import { readBootstrapConfigDefaults } from './lib/configDefaults'
import {
  findExecutionTargetByReference,
  findPolicyBundleByReference,
} from './lib/configResolution'
import { ensurePromptRequestConfigReferences } from './lib/requestCreation'
import {
  buildReviewedPromptRequestPatch,
  buildReviewedWorkflowRunPatch,
  buildRuntimeSessionCompletionPatch,
} from '../src/workflow/state'

export const beginWorkflowRunExecution = internalMutation({
  args: {
    workflowRunId: v.id('workflowRuns'),
  },
  returns: v.union(
    v.null(),
    v.object({
      promptRequestId: v.id('promptRequests'),
      runtimeSessionId: v.id('runtimeSessions'),
      startedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const workflowRun = await ctx.db.get('workflowRuns', args.workflowRunId)

    if (!workflowRun || workflowRun.status !== 'queued') {
      return null
    }

    const now = Date.now()

    await ctx.db.patch('workflowRuns', args.workflowRunId, {
      status: 'launching',
      startedAt: now,
      updatedAt: now,
    })

    const runtimeSessionId = await ctx.db.insert('runtimeSessions', {
      workflowRunId: args.workflowRunId,
      externalSessionId: undefined,
      sandboxProvider: workflowRun.sandboxProvider,
      runtimeProvider: workflowRun.runtimeProvider,
      status: 'launching',
      createdAt: now,
      updatedAt: now,
      startedAt: undefined,
      endedAt: undefined,
    })

    const promptRequest = await ctx.db.get(
      'promptRequests',
      workflowRun.promptRequestId,
    )

    if (promptRequest) {
      await ctx.db.patch('promptRequests', workflowRun.promptRequestId, {
        status: 'running',
        updatedAt: now,
      })
    }

    return {
      promptRequestId: workflowRun.promptRequestId,
      runtimeSessionId,
      startedAt: now,
    }
  },
})

export const getWorkflowRunExecutionInput = internalMutation({
  args: {
    workflowRunId: v.id('workflowRuns'),
    runtimeSessionId: v.id('runtimeSessions'),
  },
  returns: v.union(
    v.null(),
    v.object({
      workflowRunId: v.id('workflowRuns'),
      promptRequestId: v.id('promptRequests'),
      prompt: v.string(),
      scope: promptScopeValidator,
      runtimeSession: v.object({
        id: v.id('runtimeSessions'),
        workflowRunId: v.id('workflowRuns'),
        externalSessionId: v.optional(v.string()),
        sandboxProvider: v.string(),
        runtimeProvider: v.string(),
        status: runtimeSessionStatusValidator,
        createdAt: v.number(),
        updatedAt: v.number(),
        startedAt: v.optional(v.number()),
        endedAt: v.optional(v.number()),
      }),
      policyBundle: v.object({
        id: v.id('policyBundles'),
        requiredReviewers: v.array(v.string()),
        minimumScore: v.number(),
      }),
      githubInstallationExternalId: v.optional(v.number()),
      workflowStatus: workflowRunStatusValidator,
      sandboxProvider: v.string(),
      runtimeProvider: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const workflowRun = await ctx.db.get('workflowRuns', args.workflowRunId)
    const runtimeSession = await ctx.db.get(
      'runtimeSessions',
      args.runtimeSessionId,
    )

    if (!workflowRun || !runtimeSession) {
      return null
    }

    const promptRequest = await ctx.db.get(
      'promptRequests',
      workflowRun.promptRequestId,
    )

    if (!promptRequest) {
      return null
    }

    const resolvedConfig = await ensurePromptRequestConfigReferences(ctx, {
      promptRequestId: workflowRun.promptRequestId,
      projectId: promptRequest.projectId,
      repositoryConnectionId: workflowRun.repositoryConnectionId,
      executionTargetReference: String(promptRequest.executionTargetId),
      policyBundleReference: String(promptRequest.policyBundleId),
    })

    const installation = workflowRun.githubInstallationId
      ? await ctx.db.get(
          'githubInstallations',
          workflowRun.githubInstallationId,
        )
      : null

    return {
      workflowRunId: args.workflowRunId,
      promptRequestId: workflowRun.promptRequestId,
      prompt: promptRequest.prompt,
      scope: promptRequest.scope,
      runtimeSession: {
        id: args.runtimeSessionId,
        workflowRunId: runtimeSession.workflowRunId,
        externalSessionId: runtimeSession.externalSessionId,
        sandboxProvider: runtimeSession.sandboxProvider,
        runtimeProvider: runtimeSession.runtimeProvider,
        status: runtimeSession.status,
        createdAt: runtimeSession.createdAt,
        updatedAt: runtimeSession.updatedAt,
        startedAt: runtimeSession.startedAt,
        endedAt: runtimeSession.endedAt,
      },
      policyBundle: {
        id: resolvedConfig.policyBundle._id,
        requiredReviewers: [...resolvedConfig.policyBundle.requiredReviewers],
        minimumScore: resolvedConfig.policyBundle.minimumScore,
      },
      githubInstallationExternalId: installation?.externalInstallationId,
      workflowStatus: workflowRun.status,
      sandboxProvider: workflowRun.sandboxProvider,
      runtimeProvider: workflowRun.runtimeProvider,
    }
  },
})

export const recordWorkflowReviewOutcome = internalMutation({
  args: {
    workflowRunId: v.id('workflowRuns'),
    promptRequestId: v.id('promptRequests'),
    runtimeSessionId: v.id('runtimeSessions'),
    reviewRuns: v.array(
      v.object({
        reviewer: v.string(),
        score: v.number(),
        passed: v.boolean(),
        summary: v.string(),
      }),
    ),
    pendingApproval: v.optional(
      v.object({
        kind: v.string(),
        title: v.string(),
        body: v.optional(v.string()),
        requestedByUserId: v.string(),
      }),
    ),
    pendingInputs: v.array(
      v.object({
        kind: v.string(),
        prompt: v.string(),
        requestedByUserId: v.string(),
      }),
    ),
    mergeDecision: v.object({
      status: mergeDecisionStatusValidator,
      reasons: v.array(v.string()),
      decidedByUserId: v.optional(v.string()),
    }),
    reviewedAt: v.number(),
    markWorkflowReviewed: v.boolean(),
  },
  returns: v.object({
    reviewRunCount: v.number(),
    pendingApprovalCreated: v.boolean(),
    pendingInputCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const existingReviewRuns = await ctx.db
      .query('reviewRuns')
      .withIndex('by_workflow_run_id', (queryBuilder) =>
        queryBuilder.eq('workflowRunId', args.workflowRunId),
      )
      .collect()

    let reviewRunCount = 0

    for (const reviewRun of args.reviewRuns) {
      const existing = existingReviewRuns.find(
        (current) => current.reviewer === reviewRun.reviewer,
      )

      if (existing) {
        continue
      }

      await ctx.db.insert('reviewRuns', {
        requestId: args.promptRequestId,
        workflowRunId: args.workflowRunId,
        reviewer: reviewRun.reviewer,
        score: reviewRun.score,
        passed: reviewRun.passed,
        summary: reviewRun.summary,
      })
      reviewRunCount += 1
    }

    let pendingApprovalCreated = false

    if (args.pendingApproval) {
      const pendingApproval = args.pendingApproval
      const existingApprovals = await ctx.db
        .query('pendingApprovals')
        .withIndex('by_workflow_run_id', (queryBuilder) =>
          queryBuilder.eq('workflowRunId', args.workflowRunId),
        )
        .collect()

      const duplicateApproval = existingApprovals.find(
        (approval) =>
          approval.kind === pendingApproval.kind && approval.status === 'pending',
      )

      if (!duplicateApproval) {
        await ctx.db.insert('pendingApprovals', {
          promptRequestId: args.promptRequestId,
          workflowRunId: args.workflowRunId,
          runtimeSessionId: args.runtimeSessionId,
          kind: pendingApproval.kind,
          title: pendingApproval.title,
          body: pendingApproval.body,
          status: 'pending',
          requestedByUserId: pendingApproval.requestedByUserId,
          resolvedByUserId: undefined,
          createdAt: args.reviewedAt,
          updatedAt: args.reviewedAt,
          resolvedAt: undefined,
        })
        pendingApprovalCreated = true
      }
    }

    const existingInputs = await ctx.db
      .query('pendingInputs')
      .withIndex('by_workflow_run_id', (queryBuilder) =>
        queryBuilder.eq('workflowRunId', args.workflowRunId),
      )
      .collect()

    let pendingInputCount = 0

    for (const pendingInput of args.pendingInputs) {
      const duplicateInput = existingInputs.find(
        (current) =>
          current.kind === pendingInput.kind && current.status === 'pending',
      )

      if (duplicateInput) {
        continue
      }

      await ctx.db.insert('pendingInputs', {
        promptRequestId: args.promptRequestId,
        workflowRunId: args.workflowRunId,
        runtimeSessionId: args.runtimeSessionId,
        kind: pendingInput.kind,
        prompt: pendingInput.prompt,
        status: 'pending',
        requestedByUserId: pendingInput.requestedByUserId,
        response: undefined,
        resolvedByUserId: undefined,
        createdAt: args.reviewedAt,
        updatedAt: args.reviewedAt,
        resolvedAt: undefined,
      })
      pendingInputCount += 1
    }

    const existingMergeDecision = await ctx.db
      .query('mergeDecisions')
      .withIndex('by_workflow_run_id', (queryBuilder) =>
        queryBuilder.eq('workflowRunId', args.workflowRunId),
      )
      .unique()

    const workflowRun = await ctx.db.get('workflowRuns', args.workflowRunId)
    const promptRequest = await ctx.db.get('promptRequests', args.promptRequestId)
    const resolvedConfig = promptRequest
      ? await ensurePromptRequestConfigReferences(ctx, {
          promptRequestId: args.promptRequestId,
          projectId: promptRequest.projectId,
          repositoryConnectionId: workflowRun?.repositoryConnectionId,
          executionTargetReference: String(promptRequest.executionTargetId),
          policyBundleReference: String(promptRequest.policyBundleId),
        })
      : null

    if (existingMergeDecision) {
      await ctx.db.patch('mergeDecisions', existingMergeDecision._id, {
        status: args.mergeDecision.status,
        reasons: [...args.mergeDecision.reasons],
        decidedByUserId: args.mergeDecision.decidedByUserId,
        updatedAt: args.reviewedAt,
        decidedAt:
          args.mergeDecision.status === 'pending' ? undefined : args.reviewedAt,
      })
    } else if (promptRequest) {
      await ctx.db.insert('mergeDecisions', {
        workflowRunId: args.workflowRunId,
        policyBundleId: resolvedConfig?.policyBundle._id,
        status: args.mergeDecision.status,
        reasons: [...args.mergeDecision.reasons],
        decidedByUserId: args.mergeDecision.decidedByUserId,
        createdAt: args.reviewedAt,
        updatedAt: args.reviewedAt,
        decidedAt:
          args.mergeDecision.status === 'pending' ? undefined : args.reviewedAt,
      })
    }

    if (args.markWorkflowReviewed) {
      if (workflowRun) {
        await ctx.db.patch(
          'workflowRuns',
          args.workflowRunId,
          buildReviewedWorkflowRunPatch(args.reviewedAt),
        )
      }

      if (promptRequest) {
        await ctx.db.patch(
          'promptRequests',
          args.promptRequestId,
          buildReviewedPromptRequestPatch(args.reviewedAt),
        )
      }
    }

    return {
      reviewRunCount,
      pendingApprovalCreated,
      pendingInputCount,
    }
  },
})

function buildFallbackExecutionTarget(reference: string) {
  const defaults = readBootstrapConfigDefaults()

  if (reference !== defaults.executionTargetKey) {
    return null
  }

  return {
    id: reference,
    key: reference,
    repositoryConnectionId: undefined,
    sandboxProvider: defaults.sandboxProvider,
    runtimeProvider: defaults.runtimeProvider,
    defaultBaseBranch: undefined,
    enabled: true,
  }
}

function buildFallbackPolicyBundle(reference: string) {
  const defaults = readBootstrapConfigDefaults()

  if (reference !== defaults.policyBundleKey) {
    return null
  }

  return {
    id: reference,
    key: reference,
    requiredReviewers: [...defaults.requiredReviewers],
    minimumScore: defaults.minimumScore,
    enabled: true,
  }
}

type ExecutionTargetSnapshot = {
  readonly id: string
  readonly key: string
  readonly repositoryConnectionId?: string
  readonly sandboxProvider: string
  readonly runtimeProvider: string
  readonly defaultBaseBranch?: string
  readonly enabled: boolean
}

type PolicyBundleSnapshot = {
  readonly id: string
  readonly key: string
  readonly requiredReviewers: string[]
  readonly minimumScore: number
  readonly enabled: boolean
}

function normalizeExecutionTargetSnapshot(
  executionTarget:
    | {
        readonly _id: Id<'executionTargets'>
        readonly key: string
        readonly repositoryConnectionId?: Id<'repositories'>
        readonly sandboxProvider: string
        readonly runtimeProvider: string
        readonly defaultBaseBranch?: string
        readonly enabled: boolean
      }
    | {
        readonly id: string
        readonly key: string
        readonly repositoryConnectionId?: string
        readonly sandboxProvider: string
        readonly runtimeProvider: string
        readonly defaultBaseBranch?: string
        readonly enabled: boolean
      }
    | null,
): ExecutionTargetSnapshot | null {
  if (!executionTarget) {
    return null
  }

  if ('_id' in executionTarget) {
    return {
      id: String(executionTarget._id),
      key: executionTarget.key,
      repositoryConnectionId: executionTarget.repositoryConnectionId
        ? String(executionTarget.repositoryConnectionId)
        : undefined,
      sandboxProvider: executionTarget.sandboxProvider,
      runtimeProvider: executionTarget.runtimeProvider,
      defaultBaseBranch: executionTarget.defaultBaseBranch,
      enabled: executionTarget.enabled,
    }
  }

  return {
    id: executionTarget.id,
    key: executionTarget.key,
    repositoryConnectionId: executionTarget.repositoryConnectionId,
    sandboxProvider: executionTarget.sandboxProvider,
    runtimeProvider: executionTarget.runtimeProvider,
    defaultBaseBranch: executionTarget.defaultBaseBranch,
    enabled: executionTarget.enabled,
  }
}

function normalizePolicyBundleSnapshot(
  policyBundle:
    | {
        readonly _id: Id<'policyBundles'>
        readonly key: string
        readonly requiredReviewers: ReadonlyArray<string>
        readonly minimumScore: number
        readonly enabled: boolean
      }
    | {
        readonly id: string
        readonly key: string
        readonly requiredReviewers: ReadonlyArray<string>
        readonly minimumScore: number
        readonly enabled: boolean
      }
    | null,
): PolicyBundleSnapshot | null {
  if (!policyBundle) {
    return null
  }

  if ('_id' in policyBundle) {
    return {
      id: String(policyBundle._id),
      key: policyBundle.key,
      requiredReviewers: [...policyBundle.requiredReviewers],
      minimumScore: policyBundle.minimumScore,
      enabled: policyBundle.enabled,
    }
  }

  return {
    id: policyBundle.id,
    key: policyBundle.key,
    requiredReviewers: [...policyBundle.requiredReviewers],
    minimumScore: policyBundle.minimumScore,
    enabled: policyBundle.enabled,
  }
}

export const markWorkflowRunRunning = internalMutation({
  args: {
    workflowRunId: v.id('workflowRuns'),
    runtimeSessionId: v.id('runtimeSessions'),
    externalSessionId: v.string(),
    startedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch('workflowRuns', args.workflowRunId, {
      status: 'running',
      updatedAt: args.startedAt,
    })

    await ctx.db.patch('runtimeSessions', args.runtimeSessionId, {
      externalSessionId: args.externalSessionId,
      status: 'running',
      startedAt: args.startedAt,
      updatedAt: args.startedAt,
    })

    return null
  },
})

export const appendRuntimeEvents = internalMutation({
  args: {
    events: v.array(
      v.object({
        requestId: v.id('promptRequests'),
        workflowRunId: v.optional(v.id('workflowRuns')),
        runtimeSessionId: v.optional(v.id('runtimeSessions')),
        type: runtimeEventTypeValidator,
        message: v.string(),
        createdAt: v.number(),
      }),
    ),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    for (const event of args.events) {
      await ctx.db.insert('runtimeEvents', event)
    }

    return args.events.length
  },
})

export const appendRuntimeEventBatch = internalMutation({
  args: {
    providerEvents: v.array(
      v.object({
        requestId: v.id('promptRequests'),
        workflowRunId: v.optional(v.id('workflowRuns')),
        runtimeSessionId: v.optional(v.id('runtimeSessions')),
        provider: v.string(),
        eventType: v.string(),
        stream: runtimeProviderEventStreamValidator,
        sequence: v.number(),
        rawPayload: v.string(),
        providerTimestamp: v.optional(v.string()),
        createdAt: v.number(),
      }),
    ),
    events: v.array(
      v.object({
        requestId: v.id('promptRequests'),
        workflowRunId: v.optional(v.id('workflowRuns')),
        runtimeSessionId: v.optional(v.id('runtimeSessions')),
        type: runtimeEventTypeValidator,
        message: v.string(),
        createdAt: v.number(),
      }),
    ),
  },
  returns: v.object({
    providerEventCount: v.number(),
    eventCount: v.number(),
  }),
  handler: async (ctx, args) => {
    for (const providerEvent of args.providerEvents) {
      await ctx.db.insert('runtimeProviderEvents', providerEvent)
    }

    for (const event of args.events) {
      await ctx.db.insert('runtimeEvents', event)
    }

    return {
      providerEventCount: args.providerEvents.length,
      eventCount: args.events.length,
    }
  },
})

export const completeWorkflowRunExecution = internalMutation({
  args: {
    workflowRunId: v.id('workflowRuns'),
    runtimeSessionId: v.id('runtimeSessions'),
    completedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const runtimeSession = await ctx.db.get(
      'runtimeSessions',
      args.runtimeSessionId,
    )

    if (!runtimeSession) {
      return null
    }

    await ctx.db.patch(
      'runtimeSessions',
      args.runtimeSessionId,
      buildRuntimeSessionCompletionPatch(args.completedAt),
    )

    return null
  },
})

export const failWorkflowRunExecution = internalMutation({
  args: {
    workflowRunId: v.id('workflowRuns'),
    runtimeSessionId: v.id('runtimeSessions'),
    failedAt: v.number(),
    errorMessage: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const workflowRun = await ctx.db.get('workflowRuns', args.workflowRunId)

    if (!workflowRun) {
      return null
    }

    await ctx.db.patch('workflowRuns', args.workflowRunId, {
      status: 'failed',
      completedAt: args.failedAt,
      updatedAt: args.failedAt,
    })

    await ctx.db.patch('runtimeSessions', args.runtimeSessionId, {
      status: 'failed',
      endedAt: args.failedAt,
      updatedAt: args.failedAt,
    })

    await ctx.db.patch('promptRequests', workflowRun.promptRequestId, {
      status: 'failed',
      updatedAt: args.failedAt,
    })

    await ctx.db.insert('runtimeEvents', {
      requestId: workflowRun.promptRequestId,
      workflowRunId: args.workflowRunId,
      runtimeSessionId: args.runtimeSessionId,
      type: 'session.failed',
      message: args.errorMessage,
      createdAt: args.failedAt,
    })

    return null
  },
})

export const getWorkflowRunSnapshot = query({
  args: {
    workflowRunId: v.id('workflowRuns'),
  },
  returns: v.union(
    v.null(),
    v.object({
      workflowRun: v.object({
        id: v.string(),
        status: workflowRunStatusValidator,
        sandboxProvider: v.string(),
        runtimeProvider: v.string(),
        createdAt: v.number(),
        updatedAt: v.number(),
        startedAt: v.optional(v.number()),
        completedAt: v.optional(v.number()),
      }),
      promptRequest: v.object({
        id: v.string(),
        executionTargetId: v.string(),
        policyBundleId: v.string(),
        prompt: v.string(),
        status: v.string(),
        scope: promptScopeValidator,
        createdAt: v.number(),
        updatedAt: v.number(),
      }),
      executionTarget: v.union(
        v.null(),
        v.object({
          id: v.string(),
          key: v.string(),
          repositoryConnectionId: v.optional(v.string()),
          sandboxProvider: v.string(),
          runtimeProvider: v.string(),
          defaultBaseBranch: v.optional(v.string()),
          enabled: v.boolean(),
        }),
      ),
      policyBundle: v.union(
        v.null(),
        v.object({
          id: v.string(),
          key: v.string(),
          requiredReviewers: v.array(v.string()),
          minimumScore: v.number(),
          enabled: v.boolean(),
        }),
      ),
      runtimeSession: v.union(
        v.null(),
        v.object({
          id: v.string(),
          externalSessionId: v.optional(v.string()),
          status: runtimeSessionStatusValidator,
          createdAt: v.number(),
          updatedAt: v.number(),
          startedAt: v.optional(v.number()),
          endedAt: v.optional(v.number()),
        }),
      ),
      recentEvents: v.array(
        v.object({
          id: v.string(),
          type: runtimeEventTypeValidator,
          message: v.string(),
          createdAt: v.number(),
        }),
      ),
      recentProviderEvents: v.array(
        v.object({
          id: v.string(),
          provider: v.string(),
          eventType: v.string(),
          stream: runtimeProviderEventStreamValidator,
          sequence: v.number(),
          rawPayload: v.string(),
          providerTimestamp: v.optional(v.string()),
          createdAt: v.number(),
        }),
      ),
      reviewRuns: v.array(
        v.object({
          id: v.string(),
          workflowRunId: v.string(),
          reviewer: v.string(),
          score: v.number(),
          passed: v.boolean(),
          summary: v.string(),
        }),
      ),
      pendingApprovals: v.array(
        v.object({
          id: v.string(),
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
      pendingInputs: v.array(
        v.object({
          id: v.string(),
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
      mergeDecision: v.union(
        v.null(),
        v.object({
          id: v.string(),
          policyBundleId: v.optional(v.string()),
          status: mergeDecisionStatusValidator,
          reasons: v.array(v.string()),
          decidedByUserId: v.optional(v.string()),
          createdAt: v.number(),
          updatedAt: v.number(),
          decidedAt: v.optional(v.number()),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const workflowRun = await ctx.db.get('workflowRuns', args.workflowRunId)

    if (!workflowRun) {
      return null
    }

    const promptRequest = await ctx.db.get(
      'promptRequests',
      workflowRun.promptRequestId,
    )

    if (!promptRequest) {
      return null
    }

    const executionTargetReference = String(promptRequest.executionTargetId)
    const policyBundleReference = String(promptRequest.policyBundleId)
    const executionTarget =
      (await findExecutionTargetByReference(ctx.db, {
        projectId: promptRequest.projectId,
        reference: executionTargetReference,
        repositoryConnectionId: workflowRun.repositoryConnectionId,
      })) ?? buildFallbackExecutionTarget(executionTargetReference)
    const policyBundle =
      (await findPolicyBundleByReference(ctx.db, {
        projectId: promptRequest.projectId,
        reference: policyBundleReference,
      })) ?? buildFallbackPolicyBundle(policyBundleReference)
    const executionTargetSnapshot =
      normalizeExecutionTargetSnapshot(executionTarget)
    const policyBundleSnapshot = normalizePolicyBundleSnapshot(policyBundle)

    const runtimeSession = await ctx.db
      .query('runtimeSessions')
      .withIndex('by_workflow_run_id', (queryBuilder) =>
        queryBuilder.eq('workflowRunId', args.workflowRunId),
      )
      .order('desc')
      .first()

    const recentEvents = await ctx.db
      .query('runtimeEvents')
      .withIndex('by_workflow_run_id_created_at', (queryBuilder) =>
        queryBuilder.eq('workflowRunId', args.workflowRunId),
      )
      .order('desc')
      .take(20)

    const recentProviderEvents = await ctx.db
      .query('runtimeProviderEvents')
      .withIndex('by_workflow_run_id_created_at', (queryBuilder) =>
        queryBuilder.eq('workflowRunId', args.workflowRunId),
      )
      .order('desc')
      .take(50)

    const reviewRuns = await ctx.db
      .query('reviewRuns')
      .withIndex('by_workflow_run_id', (queryBuilder) =>
        queryBuilder.eq('workflowRunId', args.workflowRunId),
      )
      .collect()

    const pendingApprovals = await ctx.db
      .query('pendingApprovals')
      .withIndex('by_workflow_run_id', (queryBuilder) =>
        queryBuilder.eq('workflowRunId', args.workflowRunId),
      )
      .order('desc')
      .collect()

    const pendingInputs = await ctx.db
      .query('pendingInputs')
      .withIndex('by_workflow_run_id', (queryBuilder) =>
        queryBuilder.eq('workflowRunId', args.workflowRunId),
      )
      .order('desc')
      .collect()

    const mergeDecision = await ctx.db
      .query('mergeDecisions')
      .withIndex('by_workflow_run_id', (queryBuilder) =>
        queryBuilder.eq('workflowRunId', args.workflowRunId),
      )
      .unique()

    return {
      workflowRun: {
        id: String(workflowRun._id),
        status: workflowRun.status,
        sandboxProvider: workflowRun.sandboxProvider,
        runtimeProvider: workflowRun.runtimeProvider,
        createdAt: workflowRun.createdAt,
        updatedAt: workflowRun.updatedAt,
        startedAt: workflowRun.startedAt,
        completedAt: workflowRun.completedAt,
      },
      promptRequest: {
        id: String(promptRequest._id),
        executionTargetId: executionTargetSnapshot
          ? executionTargetSnapshot.id
          : executionTargetReference,
        policyBundleId: policyBundleSnapshot
          ? policyBundleSnapshot.id
          : policyBundleReference,
        prompt: promptRequest.prompt,
        status: promptRequest.status,
        scope: promptRequest.scope,
        createdAt: promptRequest.createdAt,
        updatedAt: promptRequest.updatedAt,
      },
      executionTarget: executionTargetSnapshot,
      policyBundle: policyBundleSnapshot,
      runtimeSession: runtimeSession
        ? {
            id: String(runtimeSession._id),
            externalSessionId: runtimeSession.externalSessionId,
            status: runtimeSession.status,
            createdAt: runtimeSession.createdAt,
            updatedAt: runtimeSession.updatedAt,
            startedAt: runtimeSession.startedAt,
            endedAt: runtimeSession.endedAt,
          }
        : null,
      recentEvents: recentEvents.map((event) => ({
        id: String(event._id),
        type: event.type,
        message: event.message,
        createdAt: event.createdAt,
      })),
      recentProviderEvents: recentProviderEvents.map((event) => ({
        id: String(event._id),
        provider: event.provider,
        eventType: event.eventType,
        stream: event.stream,
        sequence: event.sequence,
        rawPayload: event.rawPayload,
        providerTimestamp: event.providerTimestamp,
        createdAt: event.createdAt,
      })),
      reviewRuns: reviewRuns.map((reviewRun) => ({
        id: String(reviewRun._id),
        workflowRunId: String(reviewRun.workflowRunId),
        reviewer: reviewRun.reviewer,
        score: reviewRun.score,
        passed: reviewRun.passed,
        summary: reviewRun.summary,
      })),
      pendingApprovals: pendingApprovals.map((approval) => ({
        id: String(approval._id),
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
      })),
      pendingInputs: pendingInputs.map((input) => ({
        id: String(input._id),
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
      })),
      mergeDecision: mergeDecision
        ? {
            id: String(mergeDecision._id),
            policyBundleId: mergeDecision.policyBundleId
              ? String(mergeDecision.policyBundleId)
              : undefined,
            status: mergeDecision.status,
            reasons: [...mergeDecision.reasons],
            decidedByUserId: mergeDecision.decidedByUserId,
            createdAt: mergeDecision.createdAt,
            updatedAt: mergeDecision.updatedAt,
            decidedAt: mergeDecision.decidedAt,
          }
        : null,
    }
  },
})
