import { ConvexError, v } from 'convex/values'
import { internal } from '../../_generated/api'
import { mutation } from '../../_generated/server'
import {
  incomingDispatchRecoveryTimeoutMs,
  evidenceArtifactKindArg,
  verificationRequirementKindArg,
  verificationRequirementSourceArg,
  verificationPlatformArg,
  verificationPlanSourceArg,
  verificationPlanRequirementArg,
  verificationPlanReturn,
  verificationRequirementReturn,
  requireSystemIngestionSecret,
  requireWorkflowRun,
  isLatestWorkflowAttempt,
  canonicalJson,
  verificationPlanDigest,
} from '../shared'

const recordVerificationPlan = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    version: v.literal('verification-plan-v1'),
    sources: v.array(verificationPlanSourceArg),
    requirements: v.array(verificationPlanRequirementArg),
    digest: v.string(),
    createdAt: v.number(),
  },
  returns: verificationPlanReturn,
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const workflowRun = await requireWorkflowRun(ctx, args.workflowRunId)
    const promptRequest = await ctx.db.get(
      'promptRequests',
      workflowRun.promptRequestId,
    )
    const sourceKinds = new Set(args.sources.map((source) => source.kind))
    const requirementKeys = new Set(
      args.requirements.map((requirement) => requirement.key),
    )
    const computedDigest = await verificationPlanDigest(args)
    if (
      workflowRun.modelVersion !== 'v1' ||
      args.sources.length === 0 ||
      args.sources.length > 3 ||
      sourceKinds.size !== args.sources.length ||
      args.sources[0]?.kind !== 'deployment-system' ||
      args.sources.some((source, index) => {
        const expectedOrder = [
          'deployment-system',
          'workspace-policy',
          'base-repository-policy',
        ] as const
        return (
          expectedOrder.indexOf(source.kind) < index ||
          source.revision.trim().length === 0 ||
          source.revision !== source.revision.trim() ||
          source.revision.length > 256 ||
          (source.workspaceId?.length ?? 0) > 256 ||
          (source.repositoryFullName?.length ?? 0) > 253 ||
          (source.kind === 'deployment-system' &&
            (source.workspaceId !== undefined ||
              source.repositoryFullName !== undefined ||
              source.baseSha !== undefined)) ||
          (source.kind === 'workspace-policy' &&
            (source.workspaceId !== workflowRun.workspaceId ||
              source.repositoryFullName !== undefined ||
              source.baseSha !== undefined)) ||
          (source.kind === 'base-repository-policy' &&
            (source.workspaceId !== undefined ||
              source.repositoryFullName === undefined ||
              source.repositoryFullName !==
                promptRequest?.externalRef?.repositoryFullName ||
              source.baseSha === undefined ||
              !/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(source.baseSha) ||
              source.baseSha !== workflowRun.sourceBaseSha))
        )
      }) ||
      new TextEncoder().encode(
        canonicalJson({
          version: args.version,
          sources: args.sources,
          requirements: args.requirements,
        }),
      ).byteLength > 65_536 ||
      !Number.isSafeInteger(args.createdAt) ||
      args.createdAt < 0 ||
      args.requirements.length > 16 ||
      requirementKeys.size !== args.requirements.length ||
      args.requirements.some(
        (requirement) =>
          requirement.key.trim().length === 0 ||
          requirement.key !== requirement.key.trim() ||
          requirement.key.length > 128 ||
          requirement.label.trim().length === 0 ||
          requirement.label !== requirement.label.trim() ||
          requirement.label.length > 256 ||
          (requirement.command !== undefined &&
            requirement.command.length === 0) ||
          (requirement.command?.length ?? 0) > 2_000 ||
          (requirement.timeoutSeconds !== undefined &&
            (!Number.isSafeInteger(requirement.timeoutSeconds) ||
              requirement.timeoutSeconds < 0)) ||
          (requirement.timeoutSeconds ?? 0) > 1_800 ||
          (requirement.architecture !== undefined &&
            requirement.architecture.length === 0) ||
          (requirement.architecture?.length ?? 0) > 128 ||
          new Set(requirement.requiredArtifactKinds).size !==
            requirement.requiredArtifactKinds.length ||
          requirement.requiredArtifactKinds.length > 8,
      ) ||
      args.digest !== computedDigest
    ) {
      throw new ConvexError(
        'V1 verification plan must be bounded, trusted, and persisted before candidate freeze',
      )
    }
    const existing = await ctx.db
      .query('verificationPlans')
      .withIndex('by_workflow_run', (q) =>
        q.eq('workflowRunId', args.workflowRunId),
      )
      .first()
    if (existing !== null) {
      if (
        existing.digest !== args.digest ||
        canonicalJson(existing.sources) !== canonicalJson(args.sources) ||
        canonicalJson(existing.requirements) !==
          canonicalJson(args.requirements)
      ) {
        throw new ConvexError('Verification plan conflict for workflow attempt')
      }
      return {
        id: existing._id,
        workflowRunId: existing.workflowRunId,
        version: existing.version,
        sources: existing.sources,
        requirements: existing.requirements,
        digest: existing.digest,
        createdAt: existing.createdAt,
      }
    }
    if (
      !(await isLatestWorkflowAttempt(ctx, workflowRun)) ||
      (workflowRun.candidateIdentityVersion === 'incoming-pr-v1' &&
        (workflowRun.status !== 'queued' ||
          workflowRun.candidateFreezeClaimedAt !== undefined)) ||
      (workflowRun.candidateIdentityVersion !== 'incoming-pr-v1' &&
        workflowRun.status !== 'queued' &&
        workflowRun.status !== 'running')
    ) {
      throw new ConvexError(
        'Verification plan first write is not allowed in the current attempt state',
      )
    }
    const id = await ctx.db.insert('verificationPlans', {
      workflowRunId: args.workflowRunId,
      version: args.version,
      sources: args.sources,
      requirements: args.requirements,
      digest: args.digest,
      createdAt: args.createdAt,
    })
    return {
      id,
      workflowRunId: args.workflowRunId,
      version: args.version,
      sources: args.sources,
      requirements: args.requirements,
      digest: args.digest,
      createdAt: args.createdAt,
    }
  },
})

const recordVerificationRequirement = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    verificationPlanId: v.optional(v.id('verificationPlans')),
    key: v.string(),
    label: v.string(),
    kind: verificationRequirementKindArg,
    required: v.boolean(),
    command: v.optional(v.string()),
    platform: v.optional(verificationPlatformArg),
    architecture: v.optional(v.string()),
    timeoutSeconds: v.optional(v.number()),
    requiredArtifactKinds: v.array(evidenceArtifactKindArg),
    source: verificationRequirementSourceArg,
    createdAt: v.number(),
  },
  returns: verificationRequirementReturn,
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const workflowRun = await requireWorkflowRun(ctx, args.workflowRunId)
    const key = args.key.trim()
    const label = args.label.trim()
    if (key.length === 0 || label.length === 0) {
      throw new ConvexError(
        'Verification requirement key and label are required',
      )
    }
    if (workflowRun.candidateIdentityVersion === 'incoming-pr-v1') {
      const plan =
        args.verificationPlanId === undefined
          ? null
          : await ctx.db.get('verificationPlans', args.verificationPlanId)
      const planned = plan?.requirements.find(
        (requirement) => requirement.key === key,
      )
      if (
        plan === null ||
        plan.workflowRunId !== args.workflowRunId ||
        planned === undefined ||
        planned.label !== label ||
        planned.kind !== args.kind ||
        planned.required !== args.required ||
        planned.command !== args.command ||
        planned.platform !== args.platform ||
        planned.architecture !== args.architecture ||
        planned.timeoutSeconds !== args.timeoutSeconds ||
        JSON.stringify(planned.requiredArtifactKinds) !==
          JSON.stringify(args.requiredArtifactKinds)
      ) {
        throw new ConvexError(
          'Incoming PR requirement must exactly match its trusted verification plan',
        )
      }
    }
    if (args.requiredArtifactKinds.length > 16) {
      throw new ConvexError(
        'Verification requirement artifact kinds exceed limit',
      )
    }

    const existing = await ctx.db
      .query('verificationRequirements')
      .withIndex('by_workflow_run_and_key', (q) =>
        q.eq('workflowRunId', args.workflowRunId).eq('key', key),
      )
      .unique()
    if (existing !== null) {
      if (
        existing.verificationPlanId !== args.verificationPlanId ||
        existing.label !== label ||
        existing.kind !== args.kind ||
        existing.required !== args.required ||
        existing.command !== args.command ||
        existing.platform !== args.platform ||
        existing.architecture !== args.architecture ||
        existing.timeoutSeconds !== args.timeoutSeconds ||
        existing.source !== args.source ||
        JSON.stringify(existing.requiredArtifactKinds) !==
          JSON.stringify(args.requiredArtifactKinds)
      ) {
        throw new ConvexError('Verification requirement key conflict')
      }
      return {
        id: existing._id,
        workflowRunId: existing.workflowRunId,
        ...(existing.verificationPlanId === undefined
          ? {}
          : { verificationPlanId: existing.verificationPlanId }),
        key: existing.key,
        label: existing.label,
        kind: existing.kind,
        required: existing.required,
        ...(existing.command === undefined
          ? {}
          : { command: existing.command }),
        ...(existing.platform === undefined
          ? {}
          : { platform: existing.platform }),
        ...(existing.architecture === undefined
          ? {}
          : { architecture: existing.architecture }),
        ...(existing.timeoutSeconds === undefined
          ? {}
          : { timeoutSeconds: existing.timeoutSeconds }),
        requiredArtifactKinds: existing.requiredArtifactKinds,
        source: existing.source,
        createdAt: existing.createdAt,
      }
    }

    const requirement = {
      workflowRunId: args.workflowRunId,
      ...(args.verificationPlanId === undefined
        ? {}
        : { verificationPlanId: args.verificationPlanId }),
      key,
      label,
      kind: args.kind,
      required: args.required,
      ...(args.command === undefined ? {} : { command: args.command }),
      ...(args.platform === undefined ? {} : { platform: args.platform }),
      ...(args.architecture === undefined
        ? {}
        : { architecture: args.architecture }),
      ...(args.timeoutSeconds === undefined
        ? {}
        : { timeoutSeconds: args.timeoutSeconds }),
      requiredArtifactKinds: args.requiredArtifactKinds,
      source: args.source,
      createdAt: args.createdAt,
    }
    const id = await ctx.db.insert('verificationRequirements', requirement)
    return { id, ...requirement }
  },
})

const startIncomingVerificationPlan = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    verificationPlanId: v.id('verificationPlans'),
    candidatePatchSetId: v.id('candidatePatchSets'),
    incomingDispatchToken: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const [workflowRun, plan, candidate] = await Promise.all([
      requireWorkflowRun(ctx, args.workflowRunId),
      ctx.db.get('verificationPlans', args.verificationPlanId),
      ctx.db.get('candidatePatchSets', args.candidatePatchSetId),
    ])
    const latestAttempt = await isLatestWorkflowAttempt(ctx, workflowRun)
    const established =
      workflowRun.incomingVerificationPlanId === args.verificationPlanId &&
      workflowRun.incomingVerificationDispatchToken ===
        args.incomingDispatchToken &&
      workflowRun.incomingVerificationCandidatePatchSetId ===
        args.candidatePatchSetId &&
      workflowRun.incomingVerificationStartedAt !== undefined
    if (established) {
      return workflowRun.status === 'running' && latestAttempt
    }
    if (
      args.incomingDispatchToken.length < 16 ||
      workflowRun.candidateIdentityVersion !== 'incoming-pr-v1' ||
      workflowRun.status !== 'running' ||
      !latestAttempt ||
      workflowRun.incomingVerificationPlanId !== undefined ||
      workflowRun.incomingDispatchToken !== args.incomingDispatchToken ||
      workflowRun.incomingDispatchCandidatePatchSetId !==
        args.candidatePatchSetId ||
      workflowRun.incomingDispatchClaimedAt === undefined ||
      Date.now() - workflowRun.incomingDispatchClaimedAt >= 300_000 ||
      plan === null ||
      plan.workflowRunId !== args.workflowRunId ||
      candidate === null ||
      candidate.workflowRunId !== args.workflowRunId ||
      candidate.subject?.kind !== 'incoming-pull-request' ||
      candidate.status !== 'captured'
    ) {
      return false
    }
    const startedAt = Date.now()
    await ctx.db.patch('workflowRuns', args.workflowRunId, {
      incomingVerificationPlanId: args.verificationPlanId,
      incomingVerificationDispatchToken: args.incomingDispatchToken,
      incomingVerificationCandidatePatchSetId: args.candidatePatchSetId,
      incomingVerificationStartedAt: startedAt,
    })
    const planRecoveryTimeoutMs = Math.min(
      12 * 60 * 60 * 1_000,
      Math.max(
        incomingDispatchRecoveryTimeoutMs,
        plan.requirements.reduce(
          (total, plannedRequirement) =>
            total + ((plannedRequirement.timeoutSeconds ?? 900) + 900) * 1_000,
          0,
        ),
      ),
    )
    await ctx.scheduler.runAfter(
      planRecoveryTimeoutMs,
      internal.workflowStarts.expireIncomingVerificationDispatch,
      {
        workflowRunId: args.workflowRunId,
        verificationPlanId: args.verificationPlanId,
        dispatchToken: args.incomingDispatchToken,
        candidatePatchSetId: args.candidatePatchSetId,
      },
    )
    return true
  },
})

export const verificationPlanFunctions = {
  recordVerificationPlan,
  recordVerificationRequirement,
  startIncomingVerificationPlan,
}
