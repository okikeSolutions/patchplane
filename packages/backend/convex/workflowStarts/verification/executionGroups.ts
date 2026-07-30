import { ConvexError, v } from 'convex/values'
import { internal } from '../../_generated/api'
import { internalMutation, mutation, query } from '../../_generated/server'
import {
  verificationExecutionGroupRecoveryTimeoutMs,
  isEpochMillis,
  verificationPlatformArg,
  verificationExecutionGroupReturn,
  verificationResultReturn,
  sandboxExecutionReturn,
  requireSystemIngestionSecret,
  requireWorkflowRun,
  isLatestWorkflowAttempt,
  insertProvenanceEvent,
  verificationExecutionGroupValue,
  verificationResultValue,
  sandboxExecutionValue,
} from '../shared'

const claimVerificationExecutionGroup = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    verificationPlanId: v.id('verificationPlans'),
    requirementId: v.id('verificationRequirements'),
    candidatePatchSetId: v.id('candidatePatchSets'),
    stableKey: v.string(),
    claimToken: v.string(),
    incomingDispatchToken: v.string(),
    provider: v.string(),
    platform: verificationPlatformArg,
    architecture: v.string(),
    commandDigest: v.optional(v.string()),
    timeoutSeconds: v.optional(v.number()),
    claimedAt: v.number(),
  },
  returns: v.union(verificationExecutionGroupReturn, v.null()),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const [workflowRun, plan, requirement, candidate] = await Promise.all([
      requireWorkflowRun(ctx, args.workflowRunId),
      ctx.db.get('verificationPlans', args.verificationPlanId),
      ctx.db.get('verificationRequirements', args.requirementId),
      ctx.db.get('candidatePatchSets', args.candidatePatchSetId),
    ])
    const now = Date.now()
    const expectedStableKey = `${String(args.verificationPlanId)}:${String(args.requirementId)}:${String(args.candidatePatchSetId)}`
    if (args.stableKey !== expectedStableKey) {
      throw new ConvexError('Verification execution group identity mismatch')
    }
    const preexisting = await ctx.db
      .query('verificationExecutionGroups')
      .withIndex('by_workflow_stable_key', (q) =>
        q
          .eq('workflowRunId', args.workflowRunId)
          .eq('stableKey', args.stableKey),
      )
      .unique()
    if (
      preexisting !== null &&
      preexisting.status !== 'claimed' &&
      preexisting.status !== 'running'
    ) {
      return null
    }
    const expectedCommandDigest =
      requirement?.command === undefined
        ? undefined
        : `sha256:${Array.from(
            new Uint8Array(
              await crypto.subtle.digest(
                'SHA-256',
                new TextEncoder().encode(requirement.command),
              ),
            ),
            (byte) => byte.toString(16).padStart(2, '0'),
          ).join('')}`
    const establishedPlanDispatch =
      workflowRun.incomingVerificationPlanId === args.verificationPlanId &&
      workflowRun.incomingVerificationDispatchToken ===
        args.incomingDispatchToken &&
      workflowRun.incomingVerificationCandidatePatchSetId ===
        args.candidatePatchSetId &&
      workflowRun.incomingVerificationStartedAt !== undefined
    if (
      args.claimToken.length < 16 ||
      args.incomingDispatchToken.length < 16 ||
      !isEpochMillis(args.claimedAt) ||
      args.stableKey.length === 0 ||
      args.stableKey.length > 256 ||
      args.provider.length === 0 ||
      args.architecture.length === 0 ||
      args.commandDigest !== expectedCommandDigest ||
      args.timeoutSeconds !== (requirement?.timeoutSeconds ?? 900) ||
      !establishedPlanDispatch ||
      workflowRun.candidateIdentityVersion !== 'incoming-pr-v1' ||
      workflowRun.status !== 'running' ||
      !(await isLatestWorkflowAttempt(ctx, workflowRun)) ||
      plan === null ||
      plan.workflowRunId !== args.workflowRunId ||
      requirement === null ||
      requirement.workflowRunId !== args.workflowRunId ||
      requirement.verificationPlanId !== args.verificationPlanId ||
      candidate === null ||
      candidate.workflowRunId !== args.workflowRunId ||
      candidate.subject?.kind !== 'incoming-pull-request' ||
      candidate.status !== 'captured' ||
      candidate.candidateDigest === undefined ||
      (requirement.platform ?? 'linux') !== args.platform ||
      (requirement.architecture !== undefined &&
        requirement.architecture !== args.architecture)
    ) {
      throw new ConvexError('Invalid verification execution group claim')
    }
    const existing = preexisting
    if (existing !== null) {
      const retryable =
        existing.status === 'claimed' &&
        existing.startedAt === undefined &&
        now - existing.claimedAt >= 300_000
      if (!retryable) return null
      await ctx.db.patch('verificationExecutionGroups', existing._id, {
        claimToken: args.claimToken,
        claimedAt: now,
      })
      return verificationExecutionGroupValue({
        ...existing,
        claimToken: args.claimToken,
        claimedAt: now,
      })
    }
    const id = await ctx.db.insert('verificationExecutionGroups', {
      workflowRunId: args.workflowRunId,
      verificationPlanId: args.verificationPlanId,
      requirementId: args.requirementId,
      candidatePatchSetId: args.candidatePatchSetId,
      stableKey: args.stableKey,
      claimToken: args.claimToken,
      provider: args.provider,
      platform: args.platform,
      architecture: args.architecture,
      ...(args.commandDigest === undefined
        ? {}
        : { commandDigest: args.commandDigest }),
      ...(args.timeoutSeconds === undefined
        ? {}
        : { timeoutSeconds: args.timeoutSeconds }),
      sharedState: false,
      status: 'claimed',
      claimedAt: now,
    })
    const inserted = await ctx.db.get('verificationExecutionGroups', id)
    if (inserted === null) throw new ConvexError('Execution group disappeared')
    return verificationExecutionGroupValue(inserted)
  },
})

const expireIncomingVerificationDispatch = internalMutation({
  args: {
    workflowRunId: v.id('workflowRuns'),
    verificationPlanId: v.id('verificationPlans'),
    dispatchToken: v.string(),
    candidatePatchSetId: v.id('candidatePatchSets'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const workflowRun = await ctx.db.get('workflowRuns', args.workflowRunId)
    if (
      workflowRun === null ||
      workflowRun.status !== 'running' ||
      workflowRun.incomingVerificationPlanId !== args.verificationPlanId ||
      workflowRun.incomingVerificationDispatchToken !== args.dispatchToken ||
      workflowRun.incomingVerificationCandidatePatchSetId !==
        args.candidatePatchSetId
    ) {
      return null
    }
    const completedAt = Date.now()
    const [persistedGroups, candidate, requirements] = await Promise.all([
      ctx.db
        .query('verificationExecutionGroups')
        .withIndex('by_workflow_run', (q) =>
          q.eq('workflowRunId', args.workflowRunId),
        )
        .collect(),
      ctx.db.get('candidatePatchSets', args.candidatePatchSetId),
      ctx.db
        .query('verificationRequirements')
        .withIndex('by_workflow_run', (q) =>
          q.eq('workflowRunId', args.workflowRunId),
        )
        .collect(),
    ])
    const groups = [...persistedGroups]
    for (const requirement of requirements.filter(
      (plannedRequirement) =>
        plannedRequirement.verificationPlanId === args.verificationPlanId,
    )) {
      if (groups.some((group) => group.requirementId === requirement._id)) {
        continue
      }
      const commandDigest =
        requirement.command === undefined
          ? undefined
          : `sha256:${Array.from(
              new Uint8Array(
                await crypto.subtle.digest(
                  'SHA-256',
                  new TextEncoder().encode(requirement.command),
                ),
              ),
              (byte) => byte.toString(16).padStart(2, '0'),
            ).join('')}`
      const groupId = await ctx.db.insert('verificationExecutionGroups', {
        workflowRunId: args.workflowRunId,
        verificationPlanId: args.verificationPlanId,
        requirementId: requirement._id,
        candidatePatchSetId: args.candidatePatchSetId,
        stableKey: `${String(args.verificationPlanId)}:${String(requirement._id)}:${String(args.candidatePatchSetId)}`,
        claimToken: `recovery:${String(requirement._id)}`,
        provider: 'daytona',
        platform: requirement.platform ?? 'linux',
        architecture: requirement.architecture ?? 'x86_64',
        ...(commandDigest === undefined ? {} : { commandDigest }),
        timeoutSeconds: requirement.timeoutSeconds ?? 900,
        sharedState: false,
        status: 'claimed',
        claimedAt: workflowRun.incomingVerificationStartedAt ?? completedAt,
      })
      const inserted = await ctx.db.get('verificationExecutionGroups', groupId)
      if (inserted !== null) groups.push(inserted)
    }
    for (const group of groups.filter(
      (candidateGroup) =>
        candidateGroup.verificationPlanId === args.verificationPlanId &&
        candidateGroup.candidatePatchSetId === args.candidatePatchSetId &&
        (candidateGroup.status === 'claimed' ||
          candidateGroup.status === 'running'),
    )) {
      const idempotencyKey = `${String(group._id)}:result`
      const existingResult = await ctx.db
        .query('verificationResults')
        .withIndex('by_workflow_run_and_idempotency_key', (q) =>
          q
            .eq('workflowRunId', args.workflowRunId)
            .eq('idempotencyKey', idempotencyKey),
        )
        .unique()
      const requirement = await ctx.db.get(
        'verificationRequirements',
        group.requirementId,
      )
      await ctx.db.patch('verificationExecutionGroups', group._id, {
        status: 'failed',
        completedAt,
      })
      if (existingResult === null && requirement !== null) {
        await ctx.db.insert('verificationResults', {
          workflowRunId: args.workflowRunId,
          verificationPlanId: args.verificationPlanId,
          executionGroupId: group._id,
          requirementId: group.requirementId,
          candidatePatchSetId: args.candidatePatchSetId,
          ...(group.sandboxExecutionId === undefined
            ? {}
            : { sandboxExecutionId: group.sandboxExecutionId }),
          provider: group.provider,
          ...(requirement.command === undefined
            ? {}
            : { command: requirement.command }),
          ...(group.commandDigest === undefined
            ? {}
            : { commandDigest: group.commandDigest }),
          platform: group.platform,
          architecture: group.architecture,
          ...(group.providerSessionId === undefined
            ? {}
            : { providerSessionId: group.providerSessionId }),
          ...(group.providerCommandId === undefined
            ? {}
            : { providerCommandId: group.providerCommandId }),
          status: 'error',
          summary: 'Verification plan exceeded its durable recovery deadline.',
          artifactIds: [],
          producedArtifactKinds: [],
          stdoutCaptureStatus: 'failed',
          stderrCaptureStatus: 'failed',
          cleanupStatus: 'failed',
          ...(candidate?.candidateDigest === undefined
            ? {}
            : { candidateDigestBefore: candidate.candidateDigest }),
          startedAt: group.startedAt ?? group.claimedAt,
          completedAt,
          idempotencyKey,
        })
      }
    }
    await ctx.db.patch('workflowRuns', args.workflowRunId, {
      status: 'failed',
    })
    await insertProvenanceEvent(ctx, {
      workflowRunId: args.workflowRunId,
      traceId: workflowRun.traceId ?? 'legacy',
      type: 'verification-plan-execution',
      operation: 'workflowStarts.expireIncomingVerificationDispatch',
      status: 'failed',
      startedAt: workflowRun.incomingVerificationStartedAt ?? completedAt,
      completedAt,
      summary:
        'Incoming verification plan did not reach durable policy completion before its recovery deadline.',
      artifactRefs: [],
      errorCategory: 'verification-plan-recovery-timeout',
      idempotencyKey: `${String(args.workflowRunId)}:verification-plan-timeout`,
    })
    return null
  },
})

const startVerificationExecutionGroup = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    executionGroupId: v.id('verificationExecutionGroups'),
    claimToken: v.string(),
    sandboxId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const workflowRun = await requireWorkflowRun(ctx, args.workflowRunId)
    const group = await ctx.db.get(
      'verificationExecutionGroups',
      args.executionGroupId,
    )
    const reusedGroup =
      group === null
        ? null
        : await ctx.db
            .query('verificationExecutionGroups')
            .withIndex('by_provider_sandbox', (q) =>
              q.eq('provider', group.provider).eq('sandboxId', args.sandboxId),
            )
            .first()
    const reusedExecution =
      group === null
        ? null
        : await ctx.db
            .query('sandboxExecutions')
            .withIndex('by_provider_sandbox', (q) =>
              q.eq('provider', group.provider).eq('sandboxId', args.sandboxId),
            )
            .first()
    if (
      !(await isLatestWorkflowAttempt(ctx, workflowRun)) ||
      workflowRun.status !== 'running' ||
      group === null ||
      group.workflowRunId !== args.workflowRunId ||
      group.claimToken !== args.claimToken ||
      group.status !== 'claimed' ||
      group.sandboxId !== undefined ||
      (reusedGroup !== null && reusedGroup._id !== group._id) ||
      reusedExecution !== null ||
      args.sandboxId.length === 0
    ) {
      return false
    }
    await ctx.db.patch('verificationExecutionGroups', group._id, {
      status: 'running',
      sandboxId: args.sandboxId,
      startedAt: Date.now(),
    })
    await ctx.scheduler.runAfter(
      verificationExecutionGroupRecoveryTimeoutMs,
      internal.workflowStarts.expireVerificationExecutionGroup,
      {
        executionGroupId: group._id,
        claimToken: args.claimToken,
        sandboxId: args.sandboxId,
      },
    )
    return true
  },
})

const recordVerificationExecutionCommand = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    executionGroupId: v.id('verificationExecutionGroups'),
    claimToken: v.string(),
    sandboxId: v.string(),
    providerSessionId: v.string(),
    providerCommandId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const group = await ctx.db.get(
      'verificationExecutionGroups',
      args.executionGroupId,
    )
    if (
      group === null ||
      group.workflowRunId !== args.workflowRunId ||
      group.claimToken !== args.claimToken ||
      group.status !== 'running' ||
      group.sandboxId !== args.sandboxId ||
      args.providerSessionId.length === 0 ||
      args.providerSessionId.length > 256 ||
      args.providerCommandId.length === 0 ||
      args.providerCommandId.length > 256
    ) {
      return false
    }
    if (
      group.providerSessionId !== undefined ||
      group.providerCommandId !== undefined
    ) {
      return (
        group.providerSessionId === args.providerSessionId &&
        group.providerCommandId === args.providerCommandId
      )
    }
    await ctx.db.patch('verificationExecutionGroups', group._id, {
      providerSessionId: args.providerSessionId,
      providerCommandId: args.providerCommandId,
    })
    return true
  },
})

const expireVerificationExecutionGroup = internalMutation({
  args: {
    executionGroupId: v.id('verificationExecutionGroups'),
    claimToken: v.string(),
    sandboxId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const group = await ctx.db.get(
      'verificationExecutionGroups',
      args.executionGroupId,
    )
    if (
      group === null ||
      group.status !== 'running' ||
      group.claimToken !== args.claimToken ||
      group.sandboxId !== args.sandboxId
    ) {
      return null
    }
    const completedAt = Date.now()
    await ctx.db.patch('verificationExecutionGroups', group._id, {
      status: 'failed',
      completedAt,
    })
    const resultIdempotencyKey = `${String(group._id)}:result`
    const existingResult = await ctx.db
      .query('verificationResults')
      .withIndex('by_workflow_run_and_idempotency_key', (q) =>
        q
          .eq('workflowRunId', group.workflowRunId)
          .eq('idempotencyKey', resultIdempotencyKey),
      )
      .unique()
    const [requirement, candidate] = await Promise.all([
      ctx.db.get('verificationRequirements', group.requirementId),
      ctx.db.get('candidatePatchSets', group.candidatePatchSetId),
    ])
    if (existingResult === null && requirement !== null && candidate !== null) {
      await ctx.db.insert('verificationResults', {
        workflowRunId: group.workflowRunId,
        verificationPlanId: group.verificationPlanId,
        executionGroupId: group._id,
        requirementId: group.requirementId,
        candidatePatchSetId: group.candidatePatchSetId,
        ...(group.sandboxExecutionId === undefined
          ? {}
          : { sandboxExecutionId: group.sandboxExecutionId }),
        provider: group.provider,
        ...(requirement.command === undefined
          ? {}
          : { command: requirement.command }),
        ...(group.commandDigest === undefined
          ? {}
          : { commandDigest: group.commandDigest }),
        platform: group.platform,
        architecture: group.architecture,
        ...(group.providerSessionId === undefined
          ? {}
          : { providerSessionId: group.providerSessionId }),
        ...(group.providerCommandId === undefined
          ? {}
          : { providerCommandId: group.providerCommandId }),
        status: 'error',
        summary:
          'Started verification group exceeded its durable recovery deadline.',
        artifactIds: [],
        producedArtifactKinds: [],
        stdoutCaptureStatus: 'failed',
        stderrCaptureStatus: 'failed',
        cleanupStatus: 'failed',
        ...(candidate.candidateDigest === undefined
          ? {}
          : { candidateDigestBefore: candidate.candidateDigest }),
        startedAt: group.startedAt ?? group.claimedAt,
        completedAt,
        idempotencyKey: resultIdempotencyKey,
      })
    }
    const workflowRun = await ctx.db.get('workflowRuns', group.workflowRunId)
    await insertProvenanceEvent(ctx, {
      workflowRunId: group.workflowRunId,
      traceId: workflowRun?.traceId ?? 'legacy',
      type: 'verification-execution-group',
      operation: 'workflowStarts.expireVerificationExecutionGroup',
      status: 'failed',
      startedAt: group.startedAt ?? group.claimedAt,
      completedAt,
      summary:
        'Started verification execution group did not persist a terminal result before its recovery deadline.',
      artifactRefs: [],
      errorCategory: 'execution-group-recovery-timeout',
      idempotencyKey: `${String(group._id)}:recovery-timeout`,
    })
    return null
  },
})

const failVerificationExecutionGroup = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    executionGroupId: v.id('verificationExecutionGroups'),
    claimToken: v.string(),
    status: v.union(
      v.literal('failed'),
      v.literal('blocked'),
      v.literal('cancelled'),
    ),
    completedAt: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const group = await ctx.db.get(
      'verificationExecutionGroups',
      args.executionGroupId,
    )
    if (
      group === null ||
      group.workflowRunId !== args.workflowRunId ||
      group.claimToken !== args.claimToken ||
      (group.status !== 'claimed' && group.status !== 'running') ||
      !isEpochMillis(args.completedAt) ||
      args.completedAt < group.claimedAt
    ) {
      return false
    }
    await ctx.db.patch('verificationExecutionGroups', group._id, {
      status: args.status,
      completedAt: args.completedAt,
    })
    return true
  },
})

const getVerificationExecutionState = query({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    verificationPlanId: v.id('verificationPlans'),
    candidatePatchSetId: v.id('candidatePatchSets'),
  },
  returns: v.object({
    groups: v.array(verificationExecutionGroupReturn),
    results: v.array(verificationResultReturn),
    sandboxExecutions: v.array(sandboxExecutionReturn),
  }),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const groups = await ctx.db
      .query('verificationExecutionGroups')
      .withIndex('by_workflow_run', (q) =>
        q.eq('workflowRunId', args.workflowRunId),
      )
      .collect()
    const selectedGroups = groups.filter(
      (group) =>
        group.verificationPlanId === args.verificationPlanId &&
        group.candidatePatchSetId === args.candidatePatchSetId,
    )
    const groupIds = new Set(selectedGroups.map((group) => group._id))
    const [results, executions] = await Promise.all([
      ctx.db
        .query('verificationResults')
        .withIndex('by_workflow_run', (q) =>
          q.eq('workflowRunId', args.workflowRunId),
        )
        .collect(),
      ctx.db
        .query('sandboxExecutions')
        .withIndex('by_workflow_run', (q) =>
          q.eq('workflowRunId', args.workflowRunId),
        )
        .collect(),
    ])
    return {
      groups: selectedGroups.map(verificationExecutionGroupValue),
      results: results
        .filter(
          (result) =>
            result.verificationPlanId === args.verificationPlanId &&
            result.candidatePatchSetId === args.candidatePatchSetId &&
            result.executionGroupId !== undefined &&
            groupIds.has(result.executionGroupId),
        )
        .map(verificationResultValue),
      sandboxExecutions: executions
        .filter(
          (execution) =>
            execution.executionGroupId !== undefined &&
            groupIds.has(execution.executionGroupId),
        )
        .map(sandboxExecutionValue),
    }
  },
})

export const verificationExecutionGroupFunctions = {
  claimVerificationExecutionGroup,
  expireIncomingVerificationDispatch,
  startVerificationExecutionGroup,
  recordVerificationExecutionCommand,
  expireVerificationExecutionGroup,
  failVerificationExecutionGroup,
  getVerificationExecutionState,
}
