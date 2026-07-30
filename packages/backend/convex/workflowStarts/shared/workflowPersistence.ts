import type { Id } from '../../_generated/dataModel'
import { ConvexError, v } from 'convex/values'
import type { MutationCtx, QueryCtx } from '../../_generated/server'
import { workflowStartReturn } from './readModelSchemas'
import {
  evidenceArtifactReturn,
  candidatePatchSetReturn,
  verificationRequirementReturn,
  verificationResultReturn,
} from './verificationSchemas'
import {
  humanDecisionReturn,
  sandboxExecutionReturn,
  reviewRunReturn,
  reviewFindingReturn,
  policyDecisionReturn,
  publicationResultReturn,
} from './reviewSchemas'
import { insertProvenanceEvent } from './integrity'

export const decisionPublicationReplayFixtureReturn = v.object({
  workflowStart: workflowStartReturn,
  humanDecision: humanDecisionReturn,
  sandboxExecution: v.optional(sandboxExecutionReturn),
  candidatePatchSet: v.optional(candidatePatchSetReturn),
  verificationRequirements: v.array(verificationRequirementReturn),
  verificationResults: v.array(verificationResultReturn),
  reviewRun: v.optional(reviewRunReturn),
  reviewFindings: v.array(reviewFindingReturn),
  policyDecision: v.optional(policyDecisionReturn),
  evidenceArtifacts: v.array(evidenceArtifactReturn),
  trustDataTruncated: v.boolean(),
  evidenceTruncated: v.boolean(),
  verification: v.object({
    status: v.union(
      v.literal('not-configured'),
      v.literal('incomplete'),
      v.literal('passed'),
      v.literal('failed'),
    ),
    requiredCount: v.number(),
    passedCount: v.number(),
  }),
  candidateHeadSha: v.optional(v.string()),
  publicationResults: v.array(publicationResultReturn),
})

export async function createWorkflowStartRecord(
  ctx: MutationCtx,
  args: {
    workspaceId: string
    actorId: string
    actorDisplayName: string
    source: 'dev' | 'app' | 'external'
    traceId: string
    prompt: string
    lineageParent?: {
      workflowRunId: Id<'workflowRuns'>
      rootWorkflowRunId: Id<'workflowRuns'>
      attemptNumber: number
    }
    externalRef?: {
      provider: string
      deliveryId: string
      eventKind: string
      repositoryProvider?: string
      repositoryInstallationId?: string
      repositoryExternalId?: string
      repositoryOwner?: string
      repositoryName?: string
      repositoryFullName?: string
      issueExternalId?: string
      issueNumber?: number
      issueTitle?: string
      issueBody?: string
      pullRequestExternalId?: string
      pullRequestNumber?: number
      pullRequestUpdatedAt?: number
      pullRequestBaseSha?: string
      pullRequestHeadSha?: string
      pullRequestPreviousHeadSha?: string
      pullRequestHeadRef?: string
      pullRequestBaseRef?: string
      commentExternalId?: string
      url?: string
      senderProvider?: string
      senderExternalId?: string
      senderLogin?: string
    }
  },
) {
  const createdAt = Date.now()
  const promptRequestStatus = 'created' as const
  const workflowRunStatus = 'queued' as const
  const sourceBaseSha = args.externalRef?.pullRequestBaseSha?.trim()
  const sourceCommitSha = args.externalRef?.pullRequestHeadSha?.trim()
  const createsV1Attempt =
    sourceBaseSha !== undefined &&
    sourceBaseSha.length > 0 &&
    sourceCommitSha !== undefined &&
    sourceCommitSha.length > 0
  const attemptNumber =
    args.lineageParent === undefined ? 1 : args.lineageParent.attemptNumber + 1

  const promptRequestId = await ctx.db.insert('promptRequests', {
    workspaceId: args.workspaceId,
    actorId: args.actorId,
    actorDisplayName: args.actorDisplayName,
    traceId: args.traceId,
    source: args.source,
    prompt: args.prompt,
    ...(args.externalRef === undefined
      ? {}
      : { externalRef: args.externalRef }),
    status: promptRequestStatus,
    createdAt,
  })

  const workflowRunId = await ctx.db.insert('workflowRuns', {
    promptRequestId,
    workspaceId: args.workspaceId,
    traceId: args.traceId,
    status: workflowRunStatus,
    ...(createsV1Attempt
      ? {
          modelVersion: 'v1' as const,
          ...(args.lineageParent === undefined
            ? {}
            : {
                parentWorkflowRunId: args.lineageParent.workflowRunId,
                rootWorkflowRunId: args.lineageParent.rootWorkflowRunId,
              }),
          attemptNumber,
          trigger: 'intake' as const,
          candidateIdentityVersion: 'incoming-pr-v1' as const,
          sourceBaseSha,
          sourceCommitSha,
        }
      : {}),
    createdAt,
  })
  if (createsV1Attempt && args.lineageParent === undefined) {
    await ctx.db.patch('workflowRuns', workflowRunId, {
      rootWorkflowRunId: workflowRunId,
    })
  }

  await insertProvenanceEvent(ctx, {
    workflowRunId,
    traceId: args.traceId,
    type: 'workflow-start',
    operation: 'workflowStarts.create',
    status: 'succeeded',
    startedAt: createdAt,
    completedAt: createdAt,
    summary:
      args.externalRef?.repositoryFullName === undefined
        ? `Prompt recorded from ${args.source} by ${args.actorId}.`
        : `Prompt recorded from ${args.source} by ${args.actorId} for ${args.externalRef.repositoryFullName}.`,
    artifactRefs: [String(promptRequestId)],
    idempotencyKey: `${String(workflowRunId)}:workflow-start`,
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
      ...(args.externalRef === undefined
        ? {}
        : { externalRef: args.externalRef }),
      status: promptRequestStatus,
      createdAt,
    },
    workflowRun: {
      id: workflowRunId,
      promptRequestId,
      workspaceId: args.workspaceId,
      traceId: args.traceId,
      status: workflowRunStatus,
      ...(createsV1Attempt
        ? {
            modelVersion: 'v1' as const,
            rootWorkflowRunId:
              args.lineageParent?.rootWorkflowRunId ?? workflowRunId,
            ...(args.lineageParent === undefined
              ? {}
              : { parentWorkflowRunId: args.lineageParent.workflowRunId }),
            attemptNumber,
            trigger: 'intake' as const,
            candidateIdentityVersion: 'incoming-pr-v1' as const,
            sourceBaseSha,
            sourceCommitSha,
          }
        : {}),
      createdAt,
    },
  }
}

export async function workflowStartFromIds(
  ctx: QueryCtx | MutationCtx,
  ids: {
    promptRequestId: Id<'promptRequests'>
    workflowRunId: Id<'workflowRuns'>
  },
) {
  const promptRequest = await ctx.db.get('promptRequests', ids.promptRequestId)
  const workflowRun = await ctx.db.get('workflowRuns', ids.workflowRunId)

  if (promptRequest === null || workflowRun === null) {
    throw new ConvexError(
      'External workflow reference is missing workflow records',
    )
  }

  return {
    promptRequest: {
      id: promptRequest['_id'],
      workspaceId: promptRequest.workspaceId,
      actorId: promptRequest.actorId,
      traceId: promptRequest.traceId ?? 'legacy',
      source: promptRequest.source,
      prompt: promptRequest.prompt,
      ...(promptRequest.externalRef === undefined
        ? {}
        : { externalRef: promptRequest.externalRef }),
      status: promptRequest.status,
      createdAt: promptRequest.createdAt,
    },
    workflowRun: {
      id: workflowRun['_id'],
      promptRequestId: workflowRun.promptRequestId,
      workspaceId: workflowRun.workspaceId,
      traceId: workflowRun.traceId ?? 'legacy',
      status: workflowRun.status,
      ...(workflowRun.modelVersion === undefined
        ? {}
        : { modelVersion: workflowRun.modelVersion }),
      ...(workflowRun.parentWorkflowRunId === undefined
        ? {}
        : { parentWorkflowRunId: workflowRun.parentWorkflowRunId }),
      ...(workflowRun.rootWorkflowRunId === undefined
        ? {}
        : { rootWorkflowRunId: workflowRun.rootWorkflowRunId }),
      ...(workflowRun.attemptNumber === undefined
        ? {}
        : { attemptNumber: workflowRun.attemptNumber }),
      ...(workflowRun.trigger === undefined
        ? {}
        : { trigger: workflowRun.trigger }),
      ...(workflowRun.candidateIdentityVersion === undefined
        ? {}
        : { candidateIdentityVersion: workflowRun.candidateIdentityVersion }),
      ...(workflowRun.sourceBaseSha === undefined
        ? {}
        : { sourceBaseSha: workflowRun.sourceBaseSha }),
      ...(workflowRun.sourceCommitSha === undefined
        ? {}
        : { sourceCommitSha: workflowRun.sourceCommitSha }),
      createdAt: workflowRun.createdAt,
    },
  }
}

export async function existingExternalWorkflowRef(
  ctx: MutationCtx,
  workspaceId: string,
  permitRepeatedCandidatePair: boolean,
  externalRef: {
    provider: string
    deliveryId: string
    eventKind: string
    repositoryExternalId?: string
    issueExternalId?: string
    pullRequestBaseSha?: string
    pullRequestHeadSha?: string
    commentExternalId?: string
  },
) {
  const byDelivery = await ctx.db
    .query('externalWorkflowRefs')
    .withIndex('by_delivery', (q) =>
      q
        .eq('provider', externalRef.provider)
        .eq('deliveryId', externalRef.deliveryId),
    )
    .unique()
  if (byDelivery !== null) {
    if (byDelivery.workspaceId !== workspaceId) {
      throw new ConvexError(
        'External delivery is already bound to another workspace',
      )
    }
    return byDelivery
  }

  if (externalRef.commentExternalId !== undefined) {
    const byComment = await ctx.db
      .query('externalWorkflowRefs')
      .withIndex('by_comment', (q) =>
        q
          .eq('provider', externalRef.provider)
          .eq('commentExternalId', externalRef.commentExternalId),
      )
      .unique()

    if (byComment !== null) {
      if (byComment.workspaceId !== workspaceId) {
        throw new ConvexError(
          'External comment is already bound to another workspace',
        )
      }
      return byComment
    }
  }

  if (
    externalRef.repositoryExternalId !== undefined &&
    externalRef.issueExternalId !== undefined &&
    ['github.pull_request.opened', 'github.pull_request.synchronize'].includes(
      externalRef.eventKind,
    ) &&
    externalRef.pullRequestBaseSha !== undefined &&
    externalRef.pullRequestHeadSha !== undefined
  ) {
    // Transitional path while the exact base/head index is staged and backfilled.
    // Switch to that index only after Convex reports it enabled in production.
    const eventKinds = [
      'github.pull_request.opened',
      'github.pull_request.synchronize',
    ] as const
    const batches = await Promise.all(
      eventKinds.map((eventKind) =>
        ctx.db
          .query('externalWorkflowRefs')
          .withIndex('by_issue_event', (q) =>
            q
              .eq('provider', externalRef.provider)
              .eq('repositoryExternalId', externalRef.repositoryExternalId)
              .eq('issueExternalId', externalRef.issueExternalId)
              .eq('eventKind', eventKind),
          )
          .take(1_001),
      ),
    )
    if (batches.some((batch) => batch.length > 1_000)) {
      throw new ConvexError(
        'Pull request attempt lookup exceeded the staged-index migration bound',
      )
    }
    if (permitRepeatedCandidatePair) return null
    const matchingRefs = batches
      .flat()
      .filter(
        (attempt) =>
          attempt.workspaceId === workspaceId &&
          attempt.pullRequestBaseSha === externalRef.pullRequestBaseSha &&
          attempt.pullRequestHeadSha === externalRef.pullRequestHeadSha,
      )
    const matchingRuns = await Promise.all(
      matchingRefs.map(async (ref) => ({
        ref,
        run: await ctx.db.get('workflowRuns', ref.workflowRunId),
      })),
    )
    matchingRuns.sort(
      (left, right) =>
        (right.run?.attemptNumber ?? 0) - (left.run?.attemptNumber ?? 0) ||
        (right.ref.pullRequestUpdatedAt ?? 0) -
          (left.ref.pullRequestUpdatedAt ?? 0),
    )
    return matchingRuns[0]?.ref ?? null
  }

  if (
    externalRef.repositoryExternalId !== undefined &&
    externalRef.issueExternalId !== undefined
  ) {
    const issueAttempts = await ctx.db
      .query('externalWorkflowRefs')
      .withIndex('by_issue_event', (q) =>
        q
          .eq('provider', externalRef.provider)
          .eq('repositoryExternalId', externalRef.repositoryExternalId)
          .eq('issueExternalId', externalRef.issueExternalId)
          .eq('eventKind', externalRef.eventKind),
      )
      .take(1_001)
    if (issueAttempts.length > 1_000) {
      throw new ConvexError('External issue lookup exceeded its bound')
    }
    return (
      issueAttempts.find((attempt) => attempt.workspaceId === workspaceId) ??
      null
    )
  }

  return null
}

export async function latestPullRequestLineage(
  ctx: MutationCtx,
  externalRef: {
    provider: string
    workspaceId: string
    repositoryExternalId: string
    issueExternalId: string
  },
) {
  const eventKinds = [
    'github.pull_request.opened',
    'github.pull_request.synchronize',
  ] as const
  const batches = await Promise.all(
    eventKinds.map((eventKind) =>
      ctx.db
        .query('externalWorkflowRefs')
        .withIndex('by_issue_event', (q) =>
          q
            .eq('provider', externalRef.provider)
            .eq('repositoryExternalId', externalRef.repositoryExternalId)
            .eq('issueExternalId', externalRef.issueExternalId)
            .eq('eventKind', eventKind),
        )
        .take(1_001),
    ),
  )
  if (batches.some((batch) => batch.length > 1_000)) {
    throw new ConvexError('Pull request lineage lookup exceeded its bound')
  }
  const runs = await Promise.all(
    batches.flat().map((ref) => ctx.db.get('workflowRuns', ref.workflowRunId)),
  )
  const candidates = runs.filter(
    (run) =>
      run !== null &&
      run.workspaceId === externalRef.workspaceId &&
      run.candidateIdentityVersion === 'incoming-pr-v1' &&
      run.rootWorkflowRunId !== undefined &&
      run.attemptNumber !== undefined,
  )
  candidates.sort(
    (left, right) =>
      (right?.attemptNumber ?? 0) - (left?.attemptNumber ?? 0) ||
      (right?.createdAt ?? 0) - (left?.createdAt ?? 0),
  )
  const latestWebhookAttempt = candidates[0]
  if (
    latestWebhookAttempt === undefined ||
    latestWebhookAttempt === null ||
    latestWebhookAttempt.rootWorkflowRunId === undefined
  ) {
    return undefined
  }
  const latestWebhookRef = batches
    .flat()
    .find((ref) => ref.workflowRunId === latestWebhookAttempt['_id'])
  if (latestWebhookRef?.pullRequestUpdatedAt === undefined) {
    throw new ConvexError('Current pull request lineage lacks trusted ordering')
  }
  const latestAttempt = await ctx.db
    .query('workflowRuns')
    .withIndex('by_root_attempt', (q) =>
      q.eq('rootWorkflowRunId', latestWebhookAttempt.rootWorkflowRunId),
    )
    .order('desc')
    .first()
  if (latestAttempt === null || latestAttempt.attemptNumber === undefined) {
    throw new ConvexError('Pull request lineage is missing its latest attempt')
  }
  return {
    workflowRunId: latestAttempt['_id'],
    rootWorkflowRunId: latestWebhookAttempt.rootWorkflowRunId,
    attemptNumber: latestAttempt.attemptNumber,
    sourceBaseSha: latestAttempt.sourceBaseSha,
    sourceCommitSha: latestAttempt.sourceCommitSha,
    pullRequestUpdatedAt: latestWebhookRef.pullRequestUpdatedAt,
  }
}
