import { ConvexError, v } from 'convex/values'
import { internal } from '../_generated/api'
import { internalMutation, mutation, query } from '../_generated/server'
import {
  incomingDispatchRecoveryTimeoutMs,
  candidateSubjectArg,
  candidatePatchSetStatusArg,
  candidatePatchSetStatsArg,
  candidatePatchSetReturn,
  requireSystemIngestionSecret,
  requireWorkflowRun,
  isLatestWorkflowAttempt,
  requireEvidenceArtifactForWorkflow,
  insertProvenanceEvent,
} from './shared'

const getCandidatePatchSetForWorkflow = query({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
  },
  returns: v.union(v.null(), candidatePatchSetReturn),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    await requireWorkflowRun(ctx, args.workflowRunId)
    const candidate = await ctx.db
      .query('candidatePatchSets')
      .withIndex('by_workflow_run', (q) =>
        q.eq('workflowRunId', args.workflowRunId),
      )
      .unique()
    if (candidate === null) return null
    return {
      id: candidate._id,
      workflowRunId: candidate.workflowRunId,
      ...(candidate.sandboxExecutionId === undefined
        ? {}
        : { sandboxExecutionId: candidate.sandboxExecutionId }),
      ...(candidate.subject === undefined
        ? {}
        : { subject: candidate.subject }),
      status: candidate.status,
      ...(candidate.candidateDigest === undefined
        ? {}
        : { candidateDigest: candidate.candidateDigest }),
      ...(candidate.baseRef === undefined
        ? {}
        : { baseRef: candidate.baseRef }),
      ...(candidate.baseSha === undefined
        ? {}
        : { baseSha: candidate.baseSha }),
      ...(candidate.headRef === undefined
        ? {}
        : { headRef: candidate.headRef }),
      ...(candidate.headSha === undefined
        ? {}
        : { headSha: candidate.headSha }),
      ...(candidate.diffArtifactId === undefined
        ? {}
        : { diffArtifactId: candidate.diffArtifactId }),
      ...(candidate.summary === undefined
        ? {}
        : { summary: candidate.summary }),
      ...(candidate.stats === undefined ? {} : { stats: candidate.stats }),
      ...(candidate.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: candidate.idempotencyKey }),
      createdAt: candidate.createdAt,
    }
  },
})

const claimCandidateFreeze = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    leaseToken: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const workflowRun = await requireWorkflowRun(ctx, args.workflowRunId)
    if (
      workflowRun.status !== 'queued' ||
      workflowRun.candidateIdentityVersion !== 'incoming-pr-v1' ||
      !(await isLatestWorkflowAttempt(ctx, workflowRun))
    ) {
      return false
    }
    const plan = await ctx.db
      .query('verificationPlans')
      .withIndex('by_workflow_run', (q) =>
        q.eq('workflowRunId', args.workflowRunId),
      )
      .first()
    if (plan === null) return false
    const persistedRequirements = await ctx.db
      .query('verificationRequirements')
      .withIndex('by_workflow_run', (q) =>
        q.eq('workflowRunId', args.workflowRunId),
      )
      .take(17)
    if (
      persistedRequirements.length !== plan.requirements.length ||
      plan.requirements.some(
        (planned) =>
          !persistedRequirements.some(
            (persisted) =>
              persisted.verificationPlanId === plan._id &&
              persisted.key === planned.key,
          ),
      )
    ) {
      return false
    }
    const existing = await ctx.db
      .query('candidatePatchSets')
      .withIndex('by_workflow_run', (q) =>
        q.eq('workflowRunId', args.workflowRunId),
      )
      .first()
    if (existing !== null) return false
    const now = Date.now()
    if (
      workflowRun.candidateFreezeClaimedAt !== undefined &&
      now - workflowRun.candidateFreezeClaimedAt < 300_000
    ) {
      return false
    }
    if (args.leaseToken.trim().length < 16) {
      throw new ConvexError('Candidate freeze lease token is invalid')
    }
    await ctx.db.patch('workflowRuns', args.workflowRunId, {
      candidateFreezeClaimedAt: now,
      candidateFreezeLeaseToken: args.leaseToken,
    })
    return true
  },
})

const releaseCandidateFreeze = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    leaseToken: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const workflowRun = await requireWorkflowRun(ctx, args.workflowRunId)
    if (
      workflowRun.candidateFreezeClaimedAt === undefined ||
      workflowRun.candidateFreezeLeaseToken !== args.leaseToken
    ) {
      return false
    }
    await ctx.db.patch('workflowRuns', args.workflowRunId, {
      candidateFreezeClaimedAt: undefined,
      candidateFreezeLeaseToken: undefined,
    })
    return true
  },
})

const failCandidateFreeze = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    leaseToken: v.string(),
    summary: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const workflowRun = await requireWorkflowRun(ctx, args.workflowRunId)
    if (
      workflowRun.status !== 'queued' ||
      workflowRun.candidateFreezeLeaseToken !== args.leaseToken
    ) {
      return false
    }
    const completedAt = Date.now()
    await ctx.db.patch('workflowRuns', args.workflowRunId, {
      status: 'failed',
      candidateFreezeClaimedAt: undefined,
      candidateFreezeLeaseToken: undefined,
    })
    await insertProvenanceEvent(ctx, {
      workflowRunId: args.workflowRunId,
      traceId: workflowRun.traceId ?? 'legacy',
      type: 'candidate-freeze',
      operation: 'workflowStarts.failCandidateFreeze',
      status: 'failed',
      startedAt: completedAt,
      completedAt,
      summary: args.summary,
      artifactRefs: [],
      errorCategory: 'candidate-freeze',
      idempotencyKey: `${String(args.workflowRunId)}:candidate-freeze-failed`,
    })
    return true
  },
})

const claimIncomingDispatch = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    candidatePatchSetId: v.id('candidatePatchSets'),
    dispatchToken: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const workflowRun = await requireWorkflowRun(ctx, args.workflowRunId)
    const candidate = await ctx.db.get(
      'candidatePatchSets',
      args.candidatePatchSetId,
    )
    if (
      args.dispatchToken.trim().length < 16 ||
      workflowRun.candidateIdentityVersion !== 'incoming-pr-v1' ||
      !(await isLatestWorkflowAttempt(ctx, workflowRun)) ||
      candidate === null ||
      candidate.workflowRunId !== args.workflowRunId ||
      candidate.subject?.kind !== 'incoming-pull-request' ||
      candidate.status !== 'captured'
    ) {
      return false
    }
    const now = Date.now()
    const activeLease =
      workflowRun.status === 'running' &&
      workflowRun.incomingDispatchClaimedAt !== undefined &&
      now - workflowRun.incomingDispatchClaimedAt < 300_000
    if (
      workflowRun.incomingDispatchStartedAt !== undefined ||
      workflowRun.incomingVerificationStartedAt !== undefined ||
      activeLease ||
      (workflowRun.status !== 'queued' && workflowRun.status !== 'running')
    ) {
      return false
    }
    await ctx.db.patch('workflowRuns', args.workflowRunId, {
      status: 'running',
      incomingDispatchClaimedAt: now,
      incomingDispatchToken: args.dispatchToken,
      incomingDispatchCandidatePatchSetId: args.candidatePatchSetId,
    })
    return true
  },
})

const startIncomingDispatch = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    candidatePatchSetId: v.id('candidatePatchSets'),
    dispatchToken: v.string(),
    sandboxId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const workflowRun = await requireWorkflowRun(ctx, args.workflowRunId)
    if (
      args.sandboxId.trim().length === 0 ||
      !(await isLatestWorkflowAttempt(ctx, workflowRun)) ||
      workflowRun.status !== 'running' ||
      workflowRun.incomingDispatchToken !== args.dispatchToken ||
      workflowRun.incomingDispatchCandidatePatchSetId !==
        args.candidatePatchSetId ||
      workflowRun.incomingDispatchClaimedAt === undefined ||
      workflowRun.incomingVerificationStartedAt !== undefined ||
      Date.now() - workflowRun.incomingDispatchClaimedAt >= 300_000
    ) {
      return false
    }
    if (workflowRun.incomingDispatchStartedAt !== undefined) {
      return workflowRun.incomingDispatchSandboxId === args.sandboxId
    }
    await ctx.db.patch('workflowRuns', args.workflowRunId, {
      incomingDispatchStartedAt: Date.now(),
      incomingDispatchSandboxId: args.sandboxId,
    })
    await ctx.scheduler.runAfter(
      incomingDispatchRecoveryTimeoutMs,
      internal.workflowStarts.expireStartedIncomingDispatch,
      {
        workflowRunId: args.workflowRunId,
        dispatchToken: args.dispatchToken,
        sandboxId: args.sandboxId,
      },
    )
    return true
  },
})

const expireStartedIncomingDispatch = internalMutation({
  args: {
    workflowRunId: v.id('workflowRuns'),
    dispatchToken: v.string(),
    sandboxId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const workflowRun = await ctx.db.get('workflowRuns', args.workflowRunId)
    if (
      workflowRun === null ||
      workflowRun.status !== 'running' ||
      workflowRun.incomingDispatchToken !== args.dispatchToken ||
      workflowRun.incomingDispatchSandboxId !== args.sandboxId
    ) {
      return null
    }
    const completedAt = Date.now()
    await ctx.db.patch('workflowRuns', args.workflowRunId, {
      status: 'failed',
    })
    await insertProvenanceEvent(ctx, {
      workflowRunId: args.workflowRunId,
      traceId: workflowRun.traceId ?? 'legacy',
      type: 'sandbox-execution',
      operation: 'workflowStarts.expireStartedIncomingDispatch',
      status: 'failed',
      startedAt: workflowRun.incomingDispatchStartedAt ?? completedAt,
      completedAt,
      summary:
        'Started incoming dispatch did not complete all durable workflow persistence before its recovery deadline.',
      artifactRefs: [],
      errorCategory: 'execution-recovery-timeout',
      idempotencyKey: `${String(args.workflowRunId)}:incoming-dispatch-timeout`,
    })
    return null
  },
})

const validateIncomingDispatch = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    candidatePatchSetId: v.id('candidatePatchSets'),
    dispatchToken: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const workflowRun = await requireWorkflowRun(ctx, args.workflowRunId)
    return (
      (await isLatestWorkflowAttempt(ctx, workflowRun)) &&
      workflowRun.status === 'running' &&
      workflowRun.incomingDispatchToken === args.dispatchToken &&
      workflowRun.incomingDispatchCandidatePatchSetId ===
        args.candidatePatchSetId &&
      workflowRun.incomingDispatchClaimedAt !== undefined &&
      (workflowRun.incomingDispatchStartedAt !== undefined ||
        workflowRun.incomingVerificationStartedAt !== undefined ||
        Date.now() - workflowRun.incomingDispatchClaimedAt < 300_000)
    )
  },
})

const recordCandidatePatchSet = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    sandboxExecutionId: v.optional(v.id('sandboxExecutions')),
    subject: v.optional(candidateSubjectArg),
    candidateFreezeLeaseToken: v.optional(v.string()),
    status: candidatePatchSetStatusArg,
    candidateDigest: v.optional(v.string()),
    baseRef: v.optional(v.string()),
    baseSha: v.optional(v.string()),
    headRef: v.optional(v.string()),
    headSha: v.optional(v.string()),
    diffArtifactId: v.optional(v.id('evidenceArtifacts')),
    summary: v.optional(v.string()),
    stats: v.optional(candidatePatchSetStatsArg),
    idempotencyKey: v.string(),
    createdAt: v.number(),
  },
  returns: candidatePatchSetReturn,
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const workflowRun = await requireWorkflowRun(ctx, args.workflowRunId)
    if (workflowRun.modelVersion !== 'v1') {
      throw new ConvexError(
        'Legacy workflow attempts cannot accept V1 candidate evidence',
      )
    }
    const sandboxExecution =
      args.sandboxExecutionId === undefined
        ? undefined
        : await ctx.db.get('sandboxExecutions', args.sandboxExecutionId)
    if (
      args.sandboxExecutionId !== undefined &&
      (sandboxExecution === null ||
        sandboxExecution === undefined ||
        sandboxExecution.workflowRunId !== args.workflowRunId)
    ) {
      throw new ConvexError('Sandbox execution does not belong to workflow')
    }

    const diffArtifact =
      args.diffArtifactId === undefined
        ? undefined
        : await requireEvidenceArtifactForWorkflow(
            ctx,
            args.diffArtifactId,
            args.workflowRunId,
          )
    const incomingSubject =
      args.subject?.kind === 'incoming-pull-request' ? args.subject : undefined
    const generatedSubject =
      args.subject?.kind === 'sandbox-generated' ? args.subject : undefined
    if (
      generatedSubject !== undefined &&
      generatedSubject.sandboxExecutionId !== args.sandboxExecutionId
    ) {
      throw new ConvexError(
        'Generated candidate subject must match its producing sandbox execution',
      )
    }
    if (workflowRun.candidateIdentityVersion === 'incoming-pr-v1') {
      if (!(await isLatestWorkflowAttempt(ctx, workflowRun))) {
        throw new ConvexError(
          'A newer workflow attempt supersedes this candidate freeze',
        )
      }
      if (
        incomingSubject === undefined ||
        args.candidateFreezeLeaseToken === undefined ||
        workflowRun.candidateFreezeLeaseToken !== args.candidateFreezeLeaseToken
      ) {
        throw new ConvexError(
          'Current incoming-PR attempt requires its subject and active freeze lease',
        )
      }
      if (args.sandboxExecutionId !== undefined) {
        throw new ConvexError(
          'Incoming PR candidate cannot be produced by a sandbox execution',
        )
      }
      const promptRequest = await ctx.db.get(
        'promptRequests',
        workflowRun.promptRequestId,
      )
      const externalRef = promptRequest?.externalRef
      if (
        workflowRun.sourceBaseSha === undefined ||
        workflowRun.sourceCommitSha === undefined ||
        args.baseSha !== workflowRun.sourceBaseSha ||
        args.headSha !== workflowRun.sourceCommitSha ||
        incomingSubject.baseSha !== workflowRun.sourceBaseSha ||
        incomingSubject.headSha !== workflowRun.sourceCommitSha ||
        externalRef === undefined ||
        incomingSubject.repositoryProvider !== externalRef.repositoryProvider ||
        incomingSubject.repositoryExternalId !==
          externalRef.repositoryExternalId ||
        incomingSubject.repositoryOwner !== externalRef.repositoryOwner ||
        incomingSubject.repositoryName !== externalRef.repositoryName ||
        incomingSubject.repositoryFullName !== externalRef.repositoryFullName ||
        incomingSubject.pullRequestExternalId !==
          externalRef.pullRequestExternalId ||
        incomingSubject.pullRequestNumber !== externalRef.pullRequestNumber ||
        incomingSubject.sourceEventProvider !== externalRef.provider ||
        incomingSubject.sourceEventDeliveryId !== externalRef.deliveryId ||
        incomingSubject.sourceEventKind !== externalRef.eventKind
      ) {
        throw new ConvexError(
          'Incoming PR candidate subject does not match its immutable workflow identity',
        )
      }
    } else if (incomingSubject !== undefined) {
      throw new ConvexError(
        'Legacy workflow attempt cannot accept an incoming PR candidate subject',
      )
    }

    if (args.status === 'captured') {
      if (diffArtifact === undefined || diffArtifact.kind !== 'diff') {
        throw new ConvexError('Captured candidate requires a diff artifact')
      }
      if (args.candidateDigest !== `sha256:${diffArtifact.sha256}`) {
        throw new ConvexError(
          'Candidate digest must match the defining diff artifact',
        )
      }
      const expectedProducer =
        incomingSubject === undefined
          ? `sandbox:candidate:${sandboxExecution?.provider}:${sandboxExecution?.sandboxId}:${sandboxExecution?.startedAt}`
          : `source-control:github:compare:${incomingSubject.repositoryExternalId}:${incomingSubject.baseSha}...${incomingSubject.headSha}`
      if (
        diffArtifact.producer !== expectedProducer ||
        diffArtifact.subjectDigest !== args.candidateDigest
      ) {
        throw new ConvexError(
          'Candidate diff artifact must be bound to its trusted producer and subject',
        )
      }
      if (incomingSubject === undefined) {
        if (args.sandboxExecutionId === undefined) {
          throw new ConvexError(
            'Generated captured candidate requires its producing sandbox execution',
          )
        }
        if (args.headSha !== undefined || args.headRef !== undefined) {
          throw new ConvexError(
            'Generated candidate commit publication requires materialization evidence',
          )
        }
        if (args.baseSha === undefined) {
          throw new ConvexError('Captured candidate requires a base commit SHA')
        }
        if (
          workflowRun.sourceCommitSha === undefined ||
          args.baseSha !== workflowRun.sourceCommitSha
        ) {
          throw new ConvexError(
            'Generated candidate base does not match the pinned workflow source revision',
          )
        }
      }
    } else if (
      args.diffArtifactId !== undefined ||
      args.candidateDigest !== undefined
    ) {
      throw new ConvexError(
        'Non-captured candidate cannot reference a defining diff',
      )
    }

    const existingCandidates = await ctx.db
      .query('candidatePatchSets')
      .withIndex('by_workflow_run', (q) =>
        q.eq('workflowRunId', args.workflowRunId),
      )
      .take(2)
    const existing = existingCandidates.find(
      (candidate) => candidate.idempotencyKey === args.idempotencyKey,
    )
    if (existing !== undefined) {
      if (
        existing.sandboxExecutionId !== args.sandboxExecutionId ||
        JSON.stringify(existing.subject) !== JSON.stringify(args.subject) ||
        existing.status !== args.status ||
        existing.candidateDigest !== args.candidateDigest ||
        existing.baseRef !== args.baseRef ||
        existing.baseSha !== args.baseSha ||
        existing.headRef !== args.headRef ||
        existing.headSha !== args.headSha ||
        existing.diffArtifactId !== args.diffArtifactId ||
        existing.summary !== args.summary ||
        JSON.stringify(existing.stats) !== JSON.stringify(args.stats) ||
        existing.createdAt !== args.createdAt
      ) {
        throw new ConvexError('Candidate idempotency key conflict')
      }
      return {
        id: existing._id,
        workflowRunId: existing.workflowRunId,
        ...(existing.sandboxExecutionId === undefined
          ? {}
          : { sandboxExecutionId: existing.sandboxExecutionId }),
        ...(existing.subject === undefined
          ? {}
          : { subject: existing.subject }),
        status: existing.status,
        ...(existing.candidateDigest === undefined
          ? {}
          : { candidateDigest: existing.candidateDigest }),
        ...(existing.baseRef === undefined
          ? {}
          : { baseRef: existing.baseRef }),
        ...(existing.baseSha === undefined
          ? {}
          : { baseSha: existing.baseSha }),
        ...(existing.headRef === undefined
          ? {}
          : { headRef: existing.headRef }),
        ...(existing.headSha === undefined
          ? {}
          : { headSha: existing.headSha }),
        ...(existing.diffArtifactId === undefined
          ? {}
          : { diffArtifactId: existing.diffArtifactId }),
        ...(existing.summary === undefined
          ? {}
          : { summary: existing.summary }),
        ...(existing.stats === undefined ? {} : { stats: existing.stats }),
        ...(existing.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: existing.idempotencyKey }),
        createdAt: existing.createdAt,
      }
    }
    if (workflowRun.modelVersion === 'v1' && existingCandidates.length > 0) {
      throw new ConvexError('V1 workflow attempt already has a candidate')
    }

    const createdAt = args.createdAt
    const patchSet = {
      workflowRunId: args.workflowRunId,
      ...(args.sandboxExecutionId === undefined
        ? {}
        : { sandboxExecutionId: args.sandboxExecutionId }),
      ...(args.subject === undefined ? {} : { subject: args.subject }),
      status: args.status,
      ...(args.candidateDigest === undefined
        ? {}
        : { candidateDigest: args.candidateDigest }),
      ...(args.baseRef === undefined ? {} : { baseRef: args.baseRef }),
      ...(args.baseSha === undefined ? {} : { baseSha: args.baseSha }),
      ...(args.headRef === undefined ? {} : { headRef: args.headRef }),
      ...(args.headSha === undefined ? {} : { headSha: args.headSha }),
      ...(args.diffArtifactId === undefined
        ? {}
        : { diffArtifactId: args.diffArtifactId }),
      ...(args.summary === undefined ? {} : { summary: args.summary }),
      ...(args.stats === undefined ? {} : { stats: args.stats }),
      idempotencyKey: args.idempotencyKey,
      createdAt,
    }
    const id = await ctx.db.insert('candidatePatchSets', patchSet)
    if (incomingSubject !== undefined) {
      await ctx.db.patch('workflowRuns', args.workflowRunId, {
        candidateFreezeClaimedAt: undefined,
        candidateFreezeLeaseToken: undefined,
      })
    }
    await insertProvenanceEvent(ctx, {
      workflowRunId: args.workflowRunId,
      traceId: workflowRun.traceId ?? 'legacy',
      type: 'candidate-patch-set',
      operation: 'candidatePatchSet.recorded',
      status: args.status === 'failed' ? 'failed' : 'succeeded',
      startedAt: createdAt,
      completedAt: createdAt,
      summary: args.summary ?? `Candidate patch set ${args.status}.`,
      artifactRefs: [
        String(id),
        ...(args.diffArtifactId === undefined
          ? []
          : [String(args.diffArtifactId)]),
      ],
      idempotencyKey: `${String(id)}:candidate-patch-set`,
    })

    return { id, ...patchSet }
  },
})

export const candidatesFunctions = {
  getCandidatePatchSetForWorkflow,
  claimCandidateFreeze,
  releaseCandidateFreeze,
  failCandidateFreeze,
  claimIncomingDispatch,
  startIncomingDispatch,
  expireStartedIncomingDispatch,
  validateIncomingDispatch,
  recordCandidatePatchSet,
} as const
