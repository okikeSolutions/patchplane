import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import {
  evidenceArtifactKindArg,
  candidatePatchSetStatusArg,
  verificationPlatformArg,
  verificationExecutionGroupStatusArg,
  verificationLogCaptureStatusArg,
  sandboxCleanupStatusArg,
  verificationResultStatusArg,
  reviewRunStatusArg,
  decisionStatusArg,
  policyDecisionStatusArg,
  publicationResultKindArg,
  publicationResultStatusArg,
  requireSystemIngestionSecret,
  requireWorkflowRun,
  insertProvenanceEvent,
} from './shared'

const recordQueuedGitHubDelivery = mutation({
  args: {
    systemSecret: v.string(),
    deliveryId: v.string(),
    envelopeStorageKey: v.string(),
    envelopeSha256: v.string(),
    deliveryToken: v.string(),
  },
  returns: v.object({
    accepted: v.boolean(),
    deliveryToken: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    if (
      args.deliveryId.length === 0 ||
      args.deliveryId.length > 128 ||
      args.envelopeStorageKey.length === 0 ||
      args.envelopeStorageKey.length > 512 ||
      !/^[0-9a-f]{64}$/.test(args.envelopeSha256) ||
      args.deliveryToken.length === 0 ||
      args.deliveryToken.length > 128
    )
      return { accepted: false }
    const existing = await ctx.db
      .query('webhookQueueReceipts')
      .withIndex('by_provider_and_delivery_id', (q) =>
        q.eq('provider', 'github').eq('deliveryId', args.deliveryId),
      )
      .unique()
    if (existing !== null) {
      return existing.envelopeStorageKey === args.envelopeStorageKey &&
        existing.envelopeSha256 === args.envelopeSha256
        ? { accepted: true, deliveryToken: existing.activeDeliveryToken }
        : { accepted: false }
    }
    await ctx.db.insert('webhookQueueReceipts', {
      provider: 'github',
      deliveryId: args.deliveryId,
      status: 'delivering',
      envelopeStorageKey: args.envelopeStorageKey,
      envelopeSha256: args.envelopeSha256,
      activeDeliveryToken: args.deliveryToken,
      createdAt: Date.now(),
      nextAttemptAt: Date.now() + 60 * 60 * 1_000,
    })
    return { accepted: true, deliveryToken: args.deliveryToken }
  },
})

const claimStaleGitHubDeliveries = mutation({
  args: { systemSecret: v.string() },
  returns: v.array(
    v.object({
      deliveryId: v.string(),
      envelopeStorageKey: v.string(),
      envelopeSha256: v.string(),
      deliveryToken: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const now = Date.now()
    const receipts = await ctx.db
      .query('webhookQueueReceipts')
      .withIndex('by_provider_status_and_next_attempt', (q) =>
        q
          .eq('provider', 'github')
          .eq('status', 'delivering')
          .lte('nextAttemptAt', now),
      )
      .take(32)
    for (const receipt of receipts) {
      await ctx.db.patch('webhookQueueReceipts', receipt._id, {
        activeDeliveryToken: `${now}:${String(receipt._id)}`,
        processingToken: undefined,
        processingUntil: undefined,
        nextAttemptAt: now + 60 * 60 * 1_000,
      })
    }
    return receipts.map((receipt) => ({
      deliveryId: receipt.deliveryId,
      envelopeStorageKey: receipt.envelopeStorageKey,
      envelopeSha256: receipt.envelopeSha256,
      deliveryToken: `${now}:${String(receipt._id)}`,
    }))
  },
})

const getGitHubDeliveryReceipt = query({
  args: { systemSecret: v.string(), deliveryId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      status: v.union(v.literal('delivering'), v.literal('terminal')),
      envelopeStorageKey: v.string(),
      envelopeSha256: v.string(),
      activeDeliveryToken: v.string(),
      outcome: v.optional(
        v.union(
          v.literal('completed'),
          v.literal('ignored'),
          v.literal('failed'),
          v.literal('coalesced'),
        ),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const receipt = await ctx.db
      .query('webhookQueueReceipts')
      .withIndex('by_provider_and_delivery_id', (q) =>
        q.eq('provider', 'github').eq('deliveryId', args.deliveryId),
      )
      .unique()
    return receipt === null
      ? null
      : {
          status: receipt.status,
          envelopeStorageKey: receipt.envelopeStorageKey,
          envelopeSha256: receipt.envelopeSha256,
          activeDeliveryToken: receipt.activeDeliveryToken,
          ...(receipt.outcome === undefined
            ? {}
            : { outcome: receipt.outcome }),
        }
  },
})

const claimGitHubDeliveryProcessing = mutation({
  args: {
    systemSecret: v.string(),
    deliveryId: v.string(),
    deliveryToken: v.string(),
    processingToken: v.string(),
  },
  returns: v.union(
    v.literal('claimed'),
    v.literal('busy'),
    v.literal('stale'),
    v.literal('terminal'),
  ),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const receipt = await ctx.db
      .query('webhookQueueReceipts')
      .withIndex('by_provider_and_delivery_id', (q) =>
        q.eq('provider', 'github').eq('deliveryId', args.deliveryId),
      )
      .unique()
    if (
      receipt === null ||
      receipt.activeDeliveryToken !== args.deliveryToken
    ) {
      return 'stale'
    }
    if (receipt.status === 'terminal') return 'terminal'
    const now = Date.now()
    if ((receipt.processingUntil ?? 0) > now) return 'busy'
    await ctx.db.patch('webhookQueueReceipts', receipt._id, {
      processingToken: args.processingToken,
      processingUntil: now + 15 * 60 * 1_000,
    })
    return 'claimed'
  },
})

const releaseGitHubDeliveryProcessing = mutation({
  args: {
    systemSecret: v.string(),
    deliveryId: v.string(),
    deliveryToken: v.string(),
    processingToken: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const receipt = await ctx.db
      .query('webhookQueueReceipts')
      .withIndex('by_provider_and_delivery_id', (q) =>
        q.eq('provider', 'github').eq('deliveryId', args.deliveryId),
      )
      .unique()
    if (
      receipt === null ||
      receipt.status !== 'delivering' ||
      receipt.activeDeliveryToken !== args.deliveryToken ||
      receipt.processingToken !== args.processingToken
    )
      return false
    await ctx.db.patch('webhookQueueReceipts', receipt._id, {
      processingToken: undefined,
      processingUntil: undefined,
    })
    return true
  },
})

const bindQueuedGitHubDeliveryToWorkflow = mutation({
  args: {
    systemSecret: v.string(),
    deliveryId: v.string(),
    workflowRunId: v.id('workflowRuns'),
    repositoryExternalId: v.string(),
    issueExternalId: v.string(),
    pullRequestBaseSha: v.string(),
    pullRequestHeadSha: v.string(),
  },
  returns: v.union(
    v.literal('bound'),
    v.literal('coalesced'),
    v.literal('rejected'),
  ),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const [receipt, workflowRun] = await Promise.all([
      ctx.db
        .query('webhookQueueReceipts')
        .withIndex('by_provider_and_delivery_id', (q) =>
          q.eq('provider', 'github').eq('deliveryId', args.deliveryId),
        )
        .unique(),
      ctx.db.get('workflowRuns', args.workflowRunId),
    ])
    if (receipt === null || workflowRun === null) return 'rejected'
    const externalRefs = await ctx.db
      .query('externalWorkflowRefs')
      .withIndex('by_workflow_run', (q) =>
        q.eq('workflowRunId', workflowRun._id),
      )
      .take(32)
    if (
      !externalRefs.some(
        (ref) =>
          ref.provider === 'github' &&
          ref.repositoryExternalId === args.repositoryExternalId &&
          ref.issueExternalId === args.issueExternalId &&
          ref.pullRequestBaseSha === args.pullRequestBaseSha &&
          ref.pullRequestHeadSha === args.pullRequestHeadSha,
      )
    )
      return 'rejected'
    if (receipt.workflowRunId !== undefined) {
      if (receipt.workflowRunId !== workflowRun._id) return 'rejected'
      return receipt.outcome === 'coalesced' ? 'coalesced' : 'bound'
    }
    if (receipt.status !== 'delivering') return 'rejected'
    const workflowReceipts = await ctx.db
      .query('webhookQueueReceipts')
      .withIndex('by_workflow_run_and_status', (q) =>
        q.eq('workflowRunId', workflowRun._id).eq('status', 'delivering'),
      )
      .take(2)
    const activeReceipt = workflowReceipts.find(
      (candidate) => candidate._id !== receipt._id,
    )
    if (activeReceipt !== undefined) {
      await ctx.db.patch('webhookQueueReceipts', receipt._id, {
        workflowRunId: workflowRun._id,
        status: 'terminal',
        outcome: 'coalesced',
        completedAt: Date.now(),
      })
      return 'coalesced'
    }
    await ctx.db.patch('webhookQueueReceipts', receipt._id, {
      workflowRunId: workflowRun._id,
    })
    return 'bound'
  },
})

const completeQueuedGitHubDelivery = mutation({
  args: {
    systemSecret: v.string(),
    deliveryId: v.string(),
    deliveryToken: v.string(),
    processingToken: v.string(),
    workflowRunId: v.optional(v.id('workflowRuns')),
    outcome: v.union(
      v.literal('completed'),
      v.literal('ignored'),
      v.literal('failed'),
      v.literal('coalesced'),
    ),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const receipt = await ctx.db
      .query('webhookQueueReceipts')
      .withIndex('by_provider_and_delivery_id', (q) =>
        q.eq('provider', 'github').eq('deliveryId', args.deliveryId),
      )
      .unique()
    if (
      receipt === null ||
      receipt.activeDeliveryToken !== args.deliveryToken ||
      receipt.processingToken !== args.processingToken
    )
      return false
    if (receipt.status === 'terminal') {
      return (
        receipt.workflowRunId === args.workflowRunId &&
        receipt.outcome === args.outcome
      )
    }
    if (args.outcome === 'completed') {
      if (args.workflowRunId === undefined) return false
      const workflowRun = await ctx.db.get('workflowRuns', args.workflowRunId)
      if (
        workflowRun === null ||
        receipt.workflowRunId !== workflowRun._id ||
        (workflowRun.status !== 'reviewed' && workflowRun.status !== 'failed')
      ) {
        return false
      }
    } else if (args.workflowRunId !== undefined) {
      return false
    }
    await ctx.db.patch('webhookQueueReceipts', receipt._id, {
      status: 'terminal',
      outcome: args.outcome,
      ...(args.workflowRunId === undefined
        ? {}
        : { workflowRunId: args.workflowRunId }),
      completedAt: Date.now(),
    })
    return true
  },
})

const terminalizeQueuedGitHubDelivery = mutation({
  args: {
    systemSecret: v.string(),
    deliveryId: v.string(),
    deliveryToken: v.string(),
    processingToken: v.string(),
  },
  returns: v.object({
    terminalized: v.boolean(),
    workflowRunId: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    if (args.deliveryId.length === 0 || args.deliveryId.length > 128) {
      return { terminalized: false }
    }
    const receipt = await ctx.db
      .query('webhookQueueReceipts')
      .withIndex('by_provider_and_delivery_id', (q) =>
        q.eq('provider', 'github').eq('deliveryId', args.deliveryId),
      )
      .unique()
    if (
      receipt === null ||
      receipt.activeDeliveryToken !== args.deliveryToken ||
      receipt.processingToken !== args.processingToken
    )
      return { terminalized: false }
    if (receipt.status === 'terminal') {
      return {
        terminalized: true,
        ...(receipt.workflowRunId === undefined
          ? {}
          : { workflowRunId: receipt.workflowRunId }),
      }
    }
    const ref = await ctx.db
      .query('externalWorkflowRefs')
      .withIndex('by_delivery', (q) =>
        q.eq('provider', 'github').eq('deliveryId', args.deliveryId),
      )
      .unique()
    const workflowRunId = receipt.workflowRunId ?? ref?.workflowRunId
    if (workflowRunId === undefined) {
      await ctx.db.patch('webhookQueueReceipts', receipt._id, {
        status: 'terminal',
        outcome: 'failed',
        completedAt: Date.now(),
      })
      return { terminalized: true }
    }
    const activeReceipts = await ctx.db
      .query('webhookQueueReceipts')
      .withIndex('by_workflow_run_and_status', (q) =>
        q.eq('workflowRunId', workflowRunId).eq('status', 'delivering'),
      )
      .take(2)
    if (activeReceipts.some((candidate) => candidate._id !== receipt._id)) {
      await ctx.db.patch('webhookQueueReceipts', receipt._id, {
        workflowRunId,
        status: 'terminal',
        outcome: 'coalesced',
        completedAt: Date.now(),
      })
      return { terminalized: true, workflowRunId }
    }
    const workflowRun = await ctx.db.get('workflowRuns', workflowRunId)
    if (workflowRun === null) return { terminalized: false }
    if (workflowRun.status === 'reviewed' || workflowRun.status === 'failed') {
      await ctx.db.patch('webhookQueueReceipts', receipt._id, {
        status: 'terminal',
        outcome: workflowRun.status === 'reviewed' ? 'completed' : 'failed',
        workflowRunId: workflowRun._id,
        completedAt: Date.now(),
      })
      return { terminalized: true, workflowRunId: workflowRun._id }
    }
    const completedAt = Date.now()
    await ctx.db.patch('workflowRuns', workflowRun._id, { status: 'failed' })
    const groups = await ctx.db
      .query('verificationExecutionGroups')
      .withIndex('by_workflow_run', (q) =>
        q.eq('workflowRunId', workflowRun._id),
      )
      .take(32)
    if (
      workflowRun.incomingVerificationPlanId !== undefined &&
      workflowRun.incomingVerificationCandidatePatchSetId !== undefined
    ) {
      const requirements = await ctx.db
        .query('verificationRequirements')
        .withIndex('by_workflow_run', (q) =>
          q.eq('workflowRunId', workflowRun._id),
        )
        .take(32)
      for (const requirement of requirements) {
        if (
          requirement.verificationPlanId !==
            workflowRun.incomingVerificationPlanId ||
          groups.some((group) => group.requirementId === requirement._id)
        ) {
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
          workflowRunId: workflowRun._id,
          verificationPlanId: workflowRun.incomingVerificationPlanId,
          requirementId: requirement._id,
          candidatePatchSetId:
            workflowRun.incomingVerificationCandidatePatchSetId,
          stableKey: `${String(workflowRun.incomingVerificationPlanId)}:${String(requirement._id)}:${String(workflowRun.incomingVerificationCandidatePatchSetId)}`,
          claimToken: `queue-recovery:${String(requirement._id)}`,
          provider: 'daytona',
          platform: requirement.platform ?? 'linux',
          architecture: requirement.architecture ?? 'x86_64',
          ...(commandDigest === undefined ? {} : { commandDigest }),
          timeoutSeconds: requirement.timeoutSeconds ?? 900,
          sharedState: false,
          status: 'claimed',
          claimedAt: workflowRun.incomingVerificationStartedAt ?? completedAt,
        })
        const inserted = await ctx.db.get(
          'verificationExecutionGroups',
          groupId,
        )
        if (inserted !== null) groups.push(inserted)
      }
    }
    for (const group of groups) {
      if (group.status !== 'claimed' && group.status !== 'running') continue
      const idempotencyKey = `${String(group._id)}:result`
      const existingResult = await ctx.db
        .query('verificationResults')
        .withIndex('by_workflow_run_and_idempotency_key', (q) =>
          q
            .eq('workflowRunId', workflowRun._id)
            .eq('idempotencyKey', idempotencyKey),
        )
        .unique()
      const [requirement, candidate] = await Promise.all([
        ctx.db.get('verificationRequirements', group.requirementId),
        ctx.db.get('candidatePatchSets', group.candidatePatchSetId),
      ])
      await ctx.db.patch('verificationExecutionGroups', group._id, {
        status: 'failed',
        completedAt,
      })
      if (existingResult === null && requirement !== null) {
        await ctx.db.insert('verificationResults', {
          workflowRunId: workflowRun._id,
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
          summary: 'Hosted verification exhausted its queue delivery budget.',
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
    await ctx.db.patch('webhookQueueReceipts', receipt._id, {
      status: 'terminal',
      outcome: 'failed',
      workflowRunId: workflowRun._id,
      completedAt,
    })
    await insertProvenanceEvent(ctx, {
      workflowRunId: workflowRun._id,
      traceId: workflowRun.traceId ?? 'legacy',
      type: 'verification-plan-execution',
      operation: 'workflowStarts.terminalizeQueuedGitHubDelivery',
      status: 'failed',
      startedAt: workflowRun.incomingVerificationStartedAt ?? completedAt,
      completedAt,
      summary:
        'Hosted verification exhausted its bounded queue delivery budget.',
      artifactRefs: [],
      errorCategory: 'queue-delivery-exhausted',
      idempotencyKey: `${String(workflowRun._id)}:queue-delivery-exhausted`,
    })
    return { terminalized: true, workflowRunId: workflowRun._id }
  },
})

const getTrustLoopWorkflowForDelivery = query({
  args: {
    systemSecret: v.string(),
    deliveryId: v.string(),
  },
  returns: v.object({ workflowRunId: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const [ref, receipt] = await Promise.all([
      ctx.db
        .query('externalWorkflowRefs')
        .withIndex('by_delivery', (q) =>
          q.eq('provider', 'github').eq('deliveryId', args.deliveryId),
        )
        .unique(),
      ctx.db
        .query('webhookQueueReceipts')
        .withIndex('by_provider_and_delivery_id', (q) =>
          q.eq('provider', 'github').eq('deliveryId', args.deliveryId),
        )
        .unique(),
    ])
    const workflowRunId = receipt?.workflowRunId ?? ref?.workflowRunId
    return workflowRunId === undefined ? {} : { workflowRunId }
  },
})

const getTrustLoopAcceptanceSnapshot = query({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
  },
  returns: v.object({
    workflowRunId: v.string(),
    traceId: v.string(),
    workflowStatus: v.union(
      v.literal('queued'),
      v.literal('running'),
      v.literal('reviewed'),
      v.literal('failed'),
    ),
    hasRuntimeEvents: v.boolean(),
    hasRuntimeSessions: v.boolean(),
    sandboxExecutionStatuses: v.array(
      v.union(v.literal('succeeded'), v.literal('failed')),
    ),
    sandboxExecutions: v.array(
      v.object({
        id: v.string(),
        status: v.union(v.literal('succeeded'), v.literal('failed')),
        executionGroupId: v.optional(v.string()),
        providerSessionId: v.optional(v.string()),
        providerCommandId: v.optional(v.string()),
      }),
    ),
    latestSandboxExecution: v.optional(
      v.object({
        id: v.string(),
        status: v.union(v.literal('succeeded'), v.literal('failed')),
        completedAt: v.number(),
      }),
    ),
    evidenceArtifacts: v.array(
      v.object({
        id: v.string(),
        kind: evidenceArtifactKindArg,
        storageKey: v.string(),
        sizeBytes: v.number(),
        sha256: v.string(),
        createdAt: v.number(),
      }),
    ),
    candidatePatchStatuses: v.array(candidatePatchSetStatusArg),
    latestCandidatePatchSet: v.optional(
      v.object({
        id: v.string(),
        status: candidatePatchSetStatusArg,
        diffArtifactId: v.optional(v.string()),
        headSha: v.optional(v.string()),
        subjectKind: v.optional(
          v.union(
            v.literal('incoming-pull-request'),
            v.literal('sandbox-generated'),
          ),
        ),
        createdAt: v.number(),
      }),
    ),
    verificationPlans: v.array(
      v.object({
        id: v.string(),
        digest: v.string(),
        totalCount: v.number(),
        requiredCount: v.number(),
      }),
    ),
    verificationExecutionGroups: v.array(
      v.object({
        id: v.string(),
        status: verificationExecutionGroupStatusArg,
        sharedState: v.boolean(),
        sandboxId: v.optional(v.string()),
        providerSessionId: v.optional(v.string()),
        providerCommandId: v.optional(v.string()),
      }),
    ),
    verificationResults: v.array(
      v.object({
        id: v.string(),
        verificationPlanId: v.optional(v.string()),
        executionGroupId: v.optional(v.string()),
        candidatePatchSetId: v.string(),
        requirementId: v.string(),
        required: v.boolean(),
        sandboxExecutionId: v.optional(v.string()),
        status: verificationResultStatusArg,
        platform: verificationPlatformArg,
        environmentImage: v.optional(v.string()),
        providerSessionId: v.optional(v.string()),
        providerCommandId: v.optional(v.string()),
        summary: v.optional(v.string()),
        stdoutCaptureStatus: v.optional(verificationLogCaptureStatusArg),
        stderrCaptureStatus: v.optional(verificationLogCaptureStatusArg),
        cleanupStatus: v.optional(sandboxCleanupStatusArg),
        artifactIds: v.array(v.string()),
      }),
    ),
    reviewRunStatuses: v.array(reviewRunStatusArg),
    latestReviewRun: v.optional(
      v.object({
        id: v.string(),
        sandboxExecutionId: v.optional(v.string()),
        candidatePatchSetId: v.optional(v.string()),
        status: reviewRunStatusArg,
        createdAt: v.number(),
      }),
    ),
    policyDecisionStatuses: v.array(policyDecisionStatusArg),
    latestPolicyDecision: v.optional(
      v.object({
        status: policyDecisionStatusArg,
        reviewRunId: v.optional(v.string()),
        createdAt: v.number(),
      }),
    ),
    humanDecisions: v.array(
      v.object({
        id: v.string(),
        status: decisionStatusArg,
        decidedAt: v.number(),
        idempotencyKey: v.optional(v.string()),
      }),
    ),
    publicationResults: v.array(
      v.object({
        kind: publicationResultKindArg,
        status: publicationResultStatusArg,
        externalId: v.optional(v.string()),
        url: v.optional(v.string()),
        idempotencyKey: v.optional(v.string()),
      }),
    ),
    hasProvenanceEvents: v.boolean(),
  }),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const workflowRun = await requireWorkflowRun(ctx, args.workflowRunId)
    const [
      runtimeEvents,
      runtimeSessions,
      sandboxExecutions,
      evidenceArtifacts,
      candidatePatchSets,
      verificationPlans,
      verificationRequirements,
      verificationExecutionGroups,
      verificationResults,
      reviewRuns,
      policyDecisions,
      humanDecisions,
      publicationResults,
      provenanceEvents,
    ] = await Promise.all([
      ctx.db
        .query('runtimeEvents')
        .withIndex('by_workflow_run', (q) =>
          q.eq('workflowRunId', args.workflowRunId),
        )
        .take(1),
      ctx.db
        .query('runtimeSessions')
        .withIndex('by_workflow_run', (q) =>
          q.eq('workflowRunId', args.workflowRunId),
        )
        .take(1),
      ctx.db
        .query('sandboxExecutions')
        .withIndex('by_workflow_run', (q) =>
          q.eq('workflowRunId', args.workflowRunId),
        )
        .order('desc')
        .take(32),
      ctx.db
        .query('evidenceArtifacts')
        .withIndex('by_workflow_run', (q) =>
          q.eq('workflowRunId', args.workflowRunId),
        )
        .order('desc')
        .take(128),
      ctx.db
        .query('candidatePatchSets')
        .withIndex('by_workflow_run', (q) =>
          q.eq('workflowRunId', args.workflowRunId),
        )
        .order('desc')
        .take(32),
      ctx.db
        .query('verificationPlans')
        .withIndex('by_workflow_run', (q) =>
          q.eq('workflowRunId', args.workflowRunId),
        )
        .order('desc')
        .take(16),
      ctx.db
        .query('verificationRequirements')
        .withIndex('by_workflow_run', (q) =>
          q.eq('workflowRunId', args.workflowRunId),
        )
        .order('desc')
        .take(32),
      ctx.db
        .query('verificationExecutionGroups')
        .withIndex('by_workflow_run', (q) =>
          q.eq('workflowRunId', args.workflowRunId),
        )
        .order('desc')
        .take(32),
      ctx.db
        .query('verificationResults')
        .withIndex('by_workflow_run', (q) =>
          q.eq('workflowRunId', args.workflowRunId),
        )
        .order('desc')
        .take(64),
      ctx.db
        .query('reviewRuns')
        .withIndex('by_workflow_run', (q) =>
          q.eq('workflowRunId', args.workflowRunId),
        )
        .order('desc')
        .take(32),
      ctx.db
        .query('policyDecisions')
        .withIndex('by_workflow_run', (q) =>
          q.eq('workflowRunId', args.workflowRunId),
        )
        .order('desc')
        .take(32),
      ctx.db
        .query('humanDecisions')
        .withIndex('by_workflow_run', (q) =>
          q.eq('workflowRunId', args.workflowRunId),
        )
        .order('desc')
        .take(32),
      ctx.db
        .query('publicationResults')
        .withIndex('by_workflow_run', (q) =>
          q.eq('workflowRunId', args.workflowRunId),
        )
        .order('desc')
        .take(64),
      ctx.db
        .query('provenanceEvents')
        .withIndex('by_workflow_run', (q) =>
          q.eq('workflowRunId', args.workflowRunId),
        )
        .take(1),
    ])

    const latestSandboxExecution = sandboxExecutions.reduce<
      (typeof sandboxExecutions)[number] | undefined
    >(
      (latest, execution) =>
        latest === undefined || execution.completedAt > latest.completedAt
          ? execution
          : latest,
      undefined,
    )
    const latestCandidatePatchSet = candidatePatchSets.reduce<
      (typeof candidatePatchSets)[number] | undefined
    >(
      (latest, candidate) =>
        latest === undefined || candidate.createdAt > latest.createdAt
          ? candidate
          : latest,
      undefined,
    )
    const latestReviewRun = reviewRuns.reduce<
      (typeof reviewRuns)[number] | undefined
    >(
      (latest, review) =>
        latest === undefined || review.createdAt > latest.createdAt
          ? review
          : latest,
      undefined,
    )
    const latestPolicyDecision = policyDecisions.reduce<
      (typeof policyDecisions)[number] | undefined
    >(
      (latest, decision) =>
        latest === undefined || decision.createdAt > latest.createdAt
          ? decision
          : latest,
      undefined,
    )

    return {
      workflowRunId: workflowRun._id,
      traceId: workflowRun.traceId ?? 'legacy',
      workflowStatus: workflowRun.status,
      hasRuntimeEvents: runtimeEvents.length > 0,
      hasRuntimeSessions: runtimeSessions.length > 0,
      sandboxExecutionStatuses: sandboxExecutions.map(
        (execution) => execution.status,
      ),
      sandboxExecutions: sandboxExecutions.map((execution) => ({
        id: execution._id,
        status: execution.status,
        ...(execution.executionGroupId === undefined
          ? {}
          : { executionGroupId: execution.executionGroupId }),
        ...(execution.providerSessionId === undefined
          ? {}
          : { providerSessionId: execution.providerSessionId }),
        ...(execution.providerCommandId === undefined
          ? {}
          : { providerCommandId: execution.providerCommandId }),
      })),
      ...(latestSandboxExecution === undefined
        ? {}
        : {
            latestSandboxExecution: {
              id: latestSandboxExecution['_id'],
              status: latestSandboxExecution.status,
              completedAt: latestSandboxExecution.completedAt,
            },
          }),
      evidenceArtifacts: evidenceArtifacts.map((artifact) => ({
        id: artifact['_id'],
        kind: artifact.kind,
        storageKey: artifact.storageKey,
        sizeBytes: artifact.sizeBytes,
        sha256: artifact.sha256,
        createdAt: artifact.createdAt,
      })),
      candidatePatchStatuses: candidatePatchSets.map(
        (patchSet) => patchSet.status,
      ),
      ...(latestCandidatePatchSet === undefined
        ? {}
        : {
            latestCandidatePatchSet: {
              id: latestCandidatePatchSet['_id'],
              status: latestCandidatePatchSet.status,
              ...(latestCandidatePatchSet.diffArtifactId === undefined
                ? {}
                : { diffArtifactId: latestCandidatePatchSet.diffArtifactId }),
              ...(latestCandidatePatchSet.headSha === undefined
                ? {}
                : { headSha: latestCandidatePatchSet.headSha }),
              ...(latestCandidatePatchSet.subject?.kind === undefined
                ? {}
                : { subjectKind: latestCandidatePatchSet.subject.kind }),
              createdAt: latestCandidatePatchSet.createdAt,
            },
          }),
      verificationPlans: verificationPlans.map((plan) => ({
        id: plan._id,
        digest: plan.digest,
        totalCount: plan.requirements.length,
        requiredCount: plan.requirements.filter(
          (requirement) => requirement.required,
        ).length,
      })),
      verificationExecutionGroups: verificationExecutionGroups.map((group) => ({
        id: group._id,
        status: group.status,
        sharedState: group.sharedState,
        ...(group.sandboxId === undefined
          ? {}
          : { sandboxId: group.sandboxId }),
        ...(group.providerSessionId === undefined
          ? {}
          : { providerSessionId: group.providerSessionId }),
        ...(group.providerCommandId === undefined
          ? {}
          : { providerCommandId: group.providerCommandId }),
      })),
      verificationResults: verificationResults.map((result) => ({
        id: result._id,
        ...(result.verificationPlanId === undefined
          ? {}
          : { verificationPlanId: result.verificationPlanId }),
        ...(result.executionGroupId === undefined
          ? {}
          : { executionGroupId: result.executionGroupId }),
        candidatePatchSetId: result.candidatePatchSetId,
        requirementId: result.requirementId,
        required:
          verificationRequirements.find(
            (requirement) => requirement._id === result.requirementId,
          )?.required ?? false,
        ...(result.sandboxExecutionId === undefined
          ? {}
          : { sandboxExecutionId: result.sandboxExecutionId }),
        status: result.status,
        platform: result.platform,
        ...(result.environmentImage === undefined
          ? {}
          : { environmentImage: result.environmentImage }),
        ...(result.providerSessionId === undefined
          ? {}
          : { providerSessionId: result.providerSessionId }),
        ...(result.providerCommandId === undefined
          ? {}
          : { providerCommandId: result.providerCommandId }),
        ...(result.summary === undefined ? {} : { summary: result.summary }),
        ...(result.stdoutCaptureStatus === undefined
          ? {}
          : { stdoutCaptureStatus: result.stdoutCaptureStatus }),
        ...(result.stderrCaptureStatus === undefined
          ? {}
          : { stderrCaptureStatus: result.stderrCaptureStatus }),
        ...(result.cleanupStatus === undefined
          ? {}
          : { cleanupStatus: result.cleanupStatus }),
        artifactIds: result.artifactIds,
      })),
      reviewRunStatuses: reviewRuns.map((reviewRun) => reviewRun.status),
      ...(latestReviewRun === undefined
        ? {}
        : {
            latestReviewRun: {
              id: latestReviewRun['_id'],
              ...(latestReviewRun.sandboxExecutionId === undefined
                ? {}
                : { sandboxExecutionId: latestReviewRun.sandboxExecutionId }),
              ...(latestReviewRun.candidatePatchSetId === undefined
                ? {}
                : { candidatePatchSetId: latestReviewRun.candidatePatchSetId }),
              status: latestReviewRun.status,
              createdAt: latestReviewRun.createdAt,
            },
          }),
      policyDecisionStatuses: policyDecisions.map(
        (decision) => decision.status,
      ),
      ...(latestPolicyDecision === undefined
        ? {}
        : {
            latestPolicyDecision: {
              status: latestPolicyDecision.status,
              ...(latestPolicyDecision.reviewRunId === undefined
                ? {}
                : { reviewRunId: latestPolicyDecision.reviewRunId }),
              createdAt: latestPolicyDecision.createdAt,
            },
          }),
      humanDecisions: humanDecisions.map((decision) => ({
        id: decision._id,
        status: decision.status,
        decidedAt: decision.decidedAt,
        ...(decision.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: decision.idempotencyKey }),
      })),
      publicationResults: publicationResults.map((result) => ({
        kind: result.kind,
        status: result.status,
        ...(result.externalId === undefined
          ? {}
          : { externalId: result.externalId }),
        ...(result.url === undefined ? {} : { url: result.url }),
        ...(result.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: result.idempotencyKey }),
      })),
      hasProvenanceEvents: provenanceEvents.length > 0,
    }
  },
})

export const deliveriesFunctions = {
  recordQueuedGitHubDelivery,
  claimStaleGitHubDeliveries,
  getGitHubDeliveryReceipt,
  claimGitHubDeliveryProcessing,
  releaseGitHubDeliveryProcessing,
  bindQueuedGitHubDeliveryToWorkflow,
  completeQueuedGitHubDelivery,
  terminalizeQueuedGitHubDelivery,
  getTrustLoopWorkflowForDelivery,
  getTrustLoopAcceptanceSnapshot,
} as const
