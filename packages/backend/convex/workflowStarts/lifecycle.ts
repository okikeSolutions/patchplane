import { ConvexError, v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import {
  requireWorkOSWorkspace,
  requireWorkOSIdentity,
  requireMembershipPermission,
  externalWorkflowRefArg,
  workflowStartArgs,
  workflowStartReturn,
  createWorkflowStartRecord,
  workflowStartFromIds,
  existingExternalWorkflowRef,
  latestPullRequestLineage,
  requireIncomingPullRequestIdentity,
  requireSystemIngestionSecret,
  requireWorkflowRun,
  insertProvenanceEvent,
} from './shared'

const create = mutation({
  args: workflowStartArgs,
  returns: workflowStartReturn,
  handler: async (ctx, args) => {
    const identity = await requireWorkOSIdentity(ctx)
    requireWorkOSWorkspace(identity, args.workspaceId)

    if (args.actorId !== `workos:${identity.subject}`) {
      throw new ConvexError('Actor mismatch')
    }

    if (args.source !== 'app') {
      throw new ConvexError('App workflow source required')
    }

    await requireMembershipPermission(
      ctx,
      identity,
      args.workspaceId,
      'prompt:create',
    )

    return createWorkflowStartRecord(ctx, args)
  },
})

const createFromExternalIntake = mutation({
  args: {
    systemSecret: v.string(),
    workspaceId: v.string(),
    actorId: v.string(),
    actorDisplayName: v.string(),
    source: v.literal('external'),
    traceId: v.string(),
    prompt: v.string(),
    externalRef: externalWorkflowRefArg,
  },
  returns: workflowStartReturn,
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)

    requireIncomingPullRequestIdentity(args.externalRef)
    const externalRef = {
      ...args.externalRef,
      pullRequestBaseSha: args.externalRef.pullRequestBaseSha!,
      pullRequestHeadSha: args.externalRef.pullRequestHeadSha!,
      ...(args.externalRef.pullRequestPreviousHeadSha === undefined
        ? {}
        : {
            pullRequestPreviousHeadSha:
              args.externalRef.pullRequestPreviousHeadSha,
          }),
    }

    const lineageParent = await latestPullRequestLineage(ctx, {
      provider: externalRef.provider,
      workspaceId: args.workspaceId,
      repositoryExternalId: externalRef.repositoryExternalId!,
      issueExternalId: externalRef.issueExternalId!,
    })
    const advancesCurrentHead =
      lineageParent !== undefined &&
      externalRef.eventKind === 'github.pull_request.synchronize' &&
      externalRef.pullRequestPreviousHeadSha ===
        lineageParent.sourceCommitSha &&
      externalRef.pullRequestHeadSha !== lineageParent.sourceCommitSha
    const advancesCurrentBase =
      lineageParent !== undefined &&
      externalRef.eventKind === 'github.pull_request.synchronize' &&
      externalRef.pullRequestPreviousHeadSha ===
        lineageParent.sourceCommitSha &&
      externalRef.pullRequestHeadSha === lineageParent.sourceCommitSha &&
      externalRef.pullRequestBaseSha !== lineageParent.sourceBaseSha &&
      externalRef.pullRequestUpdatedAt! > lineageParent.pullRequestUpdatedAt
    const permitRepeatedCandidatePair =
      advancesCurrentBase ||
      (advancesCurrentHead &&
        externalRef.pullRequestUpdatedAt! >= lineageParent.pullRequestUpdatedAt)
    const existing = await existingExternalWorkflowRef(
      ctx,
      args.workspaceId,
      permitRepeatedCandidatePair,
      externalRef,
    )

    if (existing !== null) {
      return workflowStartFromIds(ctx, {
        promptRequestId: existing.promptRequestId,
        workflowRunId: existing.workflowRunId,
      })
    }

    if (
      lineageParent !== undefined &&
      (externalRef.pullRequestUpdatedAt! < lineageParent.pullRequestUpdatedAt ||
        (externalRef.pullRequestUpdatedAt ===
          lineageParent.pullRequestUpdatedAt &&
          !advancesCurrentHead))
    ) {
      throw new ConvexError(
        'Out-of-order pull request event cannot supersede the current candidate',
      )
    }
    if (
      lineageParent !== undefined &&
      (externalRef.eventKind !== 'github.pull_request.synchronize' ||
        lineageParent.sourceCommitSha !==
          externalRef.pullRequestPreviousHeadSha)
    ) {
      throw new ConvexError(
        'Pull request synchronize transition does not advance the current head',
      )
    }

    const workflowStart = await createWorkflowStartRecord(ctx, {
      workspaceId: args.workspaceId,
      actorId: args.actorId,
      actorDisplayName: args.actorDisplayName,
      source: args.source,
      traceId: args.traceId,
      prompt: args.prompt,
      ...(lineageParent === undefined ? {} : { lineageParent }),
      externalRef,
    })

    await ctx.db.insert('externalWorkflowRefs', {
      ...externalRef,
      workspaceId: args.workspaceId,
      promptRequestId: workflowStart.promptRequest.id,
      workflowRunId: workflowStart.workflowRun.id,
      createdAt: workflowStart.promptRequest.createdAt,
    })

    return workflowStart
  },
})

const createRerun = mutation({
  args: {
    parentWorkflowRunId: v.id('workflowRuns'),
    reason: v.string(),
    idempotencyKey: v.string(),
  },
  returns: workflowStartReturn,
  handler: async (ctx, args) => {
    const identity = await requireWorkOSIdentity(ctx)
    const parent = await requireWorkflowRun(ctx, args.parentWorkflowRunId)
    requireWorkOSWorkspace(identity, parent.workspaceId)
    await requireMembershipPermission(
      ctx,
      identity,
      parent.workspaceId,
      'run:start',
    )

    const reason = args.reason.trim()
    const idempotencyKey = args.idempotencyKey.trim()
    if (reason.length === 0 || reason.length > 1_000) {
      throw new ConvexError('Rerun reason must contain 1 to 1000 characters')
    }
    if (idempotencyKey.length === 0 || idempotencyKey.length > 200) {
      throw new ConvexError(
        'Rerun idempotency key must contain 1 to 200 characters',
      )
    }
    if (
      parent.modelVersion !== 'v1' ||
      (parent.status !== 'reviewed' && parent.status !== 'failed')
    ) {
      throw new ConvexError(
        'Only a reviewed or failed V1 workflow attempt can be rerun',
      )
    }
    if (
      parent.sourceCommitSha === undefined ||
      parent.sourceCommitSha.trim().length === 0 ||
      (parent.candidateIdentityVersion === 'incoming-pr-v1' &&
        (parent.sourceBaseSha === undefined ||
          parent.sourceBaseSha.trim().length === 0))
    ) {
      throw new ConvexError(
        'Current incoming-PR rerun requires pinned pull request base and head SHAs',
      )
    }

    const existing = await ctx.db
      .query('workflowRerunRequests')
      .withIndex('by_parent_workflow_run_and_idempotency_key', (q) =>
        q
          .eq('parentWorkflowRunId', args.parentWorkflowRunId)
          .eq('idempotencyKey', idempotencyKey),
      )
      .unique()
    if (existing !== null) {
      if (
        existing.reason !== reason ||
        existing.requestedByActorId !== `workos:${identity.subject}`
      ) {
        throw new ConvexError('Rerun idempotency key conflict')
      }
      return workflowStartFromIds(ctx, {
        promptRequestId: parent.promptRequestId,
        workflowRunId: existing.workflowRunId,
      })
    }

    const latestAttempt = await ctx.db
      .query('workflowRuns')
      .withIndex('by_root_attempt', (q) =>
        q.eq('rootWorkflowRunId', parent.rootWorkflowRunId ?? parent._id),
      )
      .order('desc')
      .first()
    if (latestAttempt !== null && latestAttempt._id !== parent._id) {
      throw new ConvexError(
        'A newer workflow attempt supersedes this rerun parent',
      )
    }

    const activePublications = await ctx.db
      .query('canonicalPublicationClaims')
      .withIndex('by_root', (q) =>
        q.eq('rootWorkflowRunId', parent.rootWorkflowRunId ?? parent._id),
      )
      .take(5)
    if (
      activePublications.some(
        (publication) => Date.now() - publication.leasedAt < 300_000,
      )
    ) {
      throw new ConvexError(
        'Workflow publication is in progress; retry the rerun request',
      )
    }

    const priorChild = await ctx.db
      .query('workflowRerunRequests')
      .withIndex('by_parent_workflow_run', (q) =>
        q.eq('parentWorkflowRunId', args.parentWorkflowRunId),
      )
      .first()
    if (priorChild !== null) {
      throw new ConvexError('Workflow attempt already has a rerun child')
    }

    const createdAt = Date.now()
    const rootWorkflowRunId = parent.rootWorkflowRunId ?? parent._id
    const workflowRunId = await ctx.db.insert('workflowRuns', {
      promptRequestId: parent.promptRequestId,
      workspaceId: parent.workspaceId,
      traceId: `${parent.traceId ?? String(parent._id)}:rerun:${idempotencyKey}`,
      status: 'queued',
      modelVersion: 'v1',
      parentWorkflowRunId: parent._id,
      rootWorkflowRunId,
      attemptNumber: (parent.attemptNumber ?? 1) + 1,
      trigger: 'rerun',
      ...(parent.candidateIdentityVersion === undefined
        ? {}
        : { candidateIdentityVersion: parent.candidateIdentityVersion }),
      ...(parent.sourceBaseSha === undefined
        ? {}
        : { sourceBaseSha: parent.sourceBaseSha }),
      ...(parent.sourceCommitSha === undefined
        ? {}
        : { sourceCommitSha: parent.sourceCommitSha }),
      createdAt,
    })
    await ctx.db.insert('workflowRerunRequests', {
      parentWorkflowRunId: parent._id,
      workflowRunId,
      workspaceId: parent.workspaceId,
      requestedByActorId: `workos:${identity.subject}`,
      reason,
      idempotencyKey,
      createdAt,
    })
    await insertProvenanceEvent(ctx, {
      workflowRunId,
      traceId: `${parent.traceId ?? String(parent._id)}:rerun:${idempotencyKey}`,
      type: 'workflow-rerun',
      operation: 'workflowStarts.createRerun',
      status: 'succeeded',
      startedAt: createdAt,
      completedAt: createdAt,
      summary: reason,
      artifactRefs: [String(parent._id)],
      idempotencyKey: `${String(workflowRunId)}:workflow-rerun`,
    })

    return workflowStartFromIds(ctx, {
      promptRequestId: parent.promptRequestId,
      workflowRunId,
    })
  },
})

const getWorkflowExecutionFixture = query({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
  },
  returns: workflowStartReturn,
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const workflowRun = await requireWorkflowRun(ctx, args.workflowRunId)
    if (workflowRun.modelVersion !== 'v1' || workflowRun.status !== 'queued') {
      throw new ConvexError(
        'Workflow execution fixture requires a queued V1 attempt',
      )
    }
    const workflowStart = await workflowStartFromIds(ctx, {
      promptRequestId: workflowRun.promptRequestId,
      workflowRunId: workflowRun._id,
    })
    const rerunRequest = await ctx.db
      .query('workflowRerunRequests')
      .withIndex('by_workflow_run', (q) =>
        q.eq('workflowRunId', workflowRun._id),
      )
      .unique()
    if (rerunRequest === null) return workflowStart
    return {
      ...workflowStart,
      promptRequest: {
        ...workflowStart.promptRequest,
        prompt: `${workflowStart.promptRequest.prompt}\n\nRerun instruction from the reviewer:\n${rerunRequest.reason}`,
      },
    }
  },
})

const claimWorkflowExecution = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const workflowRun = await requireWorkflowRun(ctx, args.workflowRunId)
    if (
      workflowRun.status !== 'queued' ||
      workflowRun.candidateIdentityVersion === 'incoming-pr-v1'
    ) {
      return false
    }
    if (
      workflowRun.modelVersion === 'v1' &&
      (workflowRun.sourceCommitSha === undefined ||
        workflowRun.sourceCommitSha.trim().length === 0 ||
        (workflowRun.candidateIdentityVersion === 'incoming-pr-v1' &&
          (workflowRun.sourceBaseSha === undefined ||
            workflowRun.sourceBaseSha.trim().length === 0)))
    ) {
      const failedAt = Date.now()
      await ctx.db.patch('workflowRuns', args.workflowRunId, {
        status: 'failed',
      })
      await insertProvenanceEvent(ctx, {
        workflowRunId: args.workflowRunId,
        traceId: workflowRun.traceId ?? 'legacy',
        type: 'workflow-start',
        operation: 'workflowStarts.claimWorkflowExecution',
        status: 'failed',
        startedAt: failedAt,
        completedAt: failedAt,
        summary: 'V1 workflow execution requires a pinned source commit SHA.',
        artifactRefs: [],
        errorCategory: 'setup',
        idempotencyKey: `${String(args.workflowRunId)}:missing-source-revision`,
      })
      return false
    }
    if (
      workflowRun.modelVersion === 'v1' &&
      workflowRun.rootWorkflowRunId !== undefined
    ) {
      const latestAttempt = await ctx.db
        .query('workflowRuns')
        .withIndex('by_root_attempt', (q) =>
          q.eq('rootWorkflowRunId', workflowRun.rootWorkflowRunId),
        )
        .order('desc')
        .first()
      if (latestAttempt !== null && latestAttempt._id !== workflowRun._id) {
        return false
      }
    }
    if (workflowRun.modelVersion === 'v1') {
      const existingExecution = await ctx.db
        .query('sandboxExecutions')
        .withIndex('by_workflow_run', (q) =>
          q.eq('workflowRunId', args.workflowRunId),
        )
        .first()
      if (existingExecution !== null) return false
    }
    await ctx.db.patch('workflowRuns', args.workflowRunId, {
      status: 'running',
    })
    return true
  },
})

const markWorkflowExecutionFailed = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    incomingDispatchToken: v.optional(v.string()),
    summary: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const workflowRun = await requireWorkflowRun(ctx, args.workflowRunId)
    if (workflowRun.status === 'failed') return true
    if (
      workflowRun.status !== 'running' ||
      (workflowRun.candidateIdentityVersion === 'incoming-pr-v1' &&
        workflowRun.incomingDispatchToken !== args.incomingDispatchToken)
    ) {
      return false
    }
    const completedAt = Date.now()
    await ctx.db.patch('workflowRuns', args.workflowRunId, {
      status: 'failed',
    })
    await insertProvenanceEvent(ctx, {
      workflowRunId: args.workflowRunId,
      traceId: workflowRun.traceId ?? 'legacy',
      type: 'sandbox-execution',
      operation: 'workflowStarts.markWorkflowExecutionFailed',
      status: 'failed',
      startedAt: completedAt,
      completedAt,
      summary: args.summary,
      artifactRefs: [],
      errorCategory: 'execution',
      idempotencyKey: `${String(args.workflowRunId)}:execution-failed`,
    })
    return true
  },
})

export const lifecycleFunctions = {
  create,
  createFromExternalIntake,
  createRerun,
  getWorkflowExecutionFixture,
  claimWorkflowExecution,
  markWorkflowExecutionFailed,
} as const
