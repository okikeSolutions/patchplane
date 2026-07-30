import { v } from 'convex/values'
import { query } from '../../_generated/server'
import {
  requireWorkOSWorkspace,
  requireWorkOSIdentity,
  requireMembershipPermission,
  workflowStartReturn,
} from '../shared'

const listRecent = query({
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

      const [
        recentExecutions,
        latestCandidate,
        latestReview,
        latestPolicy,
        latestDecision,
      ] = await Promise.all([
        ctx.db
          .query('sandboxExecutions')
          .withIndex('by_workflow_run', (q) =>
            q.eq('workflowRunId', workflowRun['_id']),
          )
          .order('desc')
          .take(32),
        ctx.db
          .query('candidatePatchSets')
          .withIndex('by_workflow_run', (q) =>
            q.eq('workflowRunId', workflowRun['_id']),
          )
          .order('desc')
          .first(),
        ctx.db
          .query('reviewRuns')
          .withIndex('by_workflow_run', (q) =>
            q.eq('workflowRunId', workflowRun['_id']),
          )
          .order('desc')
          .first(),
        ctx.db
          .query('policyDecisions')
          .withIndex('by_workflow_run', (q) =>
            q.eq('workflowRunId', workflowRun['_id']),
          )
          .order('desc')
          .first(),
        ctx.db
          .query('humanDecisions')
          .withIndex('by_workflow_run', (q) =>
            q.eq('workflowRunId', workflowRun['_id']),
          )
          .order('desc')
          .first(),
      ])
      const latestExecution = recentExecutions.reduce<
        (typeof recentExecutions)[number] | undefined
      >(
        (latest, execution) =>
          latest === undefined || execution.completedAt > latest.completedAt
            ? execution
            : latest,
        undefined,
      )
      const decisionIsCurrent =
        latestDecision !== null &&
        latestExecution !== undefined &&
        latestCandidate !== null &&
        latestReview !== null &&
        latestPolicy !== null &&
        latestDecision.sandboxExecutionId === latestExecution['_id'] &&
        latestDecision.candidatePatchSetId === latestCandidate['_id'] &&
        latestDecision.reviewRunId === latestReview['_id'] &&
        latestDecision.policyDecisionId === latestPolicy['_id'] &&
        latestReview.sandboxExecutionId === latestExecution['_id'] &&
        latestReview.candidatePatchSetId === latestCandidate['_id'] &&
        latestPolicy.reviewRunId === latestReview['_id']
      const trustState =
        workflowRun.status === 'queued'
          ? ('queued' as const)
          : workflowRun.status === 'running'
            ? ('running' as const)
            : latestExecution === undefined
              ? ('no-sandbox-run' as const)
              : latestExecution.status === 'failed'
                ? ('sandbox-failed' as const)
                : decisionIsCurrent && latestDecision !== null
                  ? latestDecision.status
                  : ('needs-review' as const)
      const updatedAt = Math.max(
        workflowRun.createdAt,
        latestExecution?.completedAt ?? 0,
        latestCandidate?.createdAt ?? 0,
        latestReview?.completedAt ?? latestReview?.startedAt ?? 0,
        latestPolicy?.createdAt ?? 0,
        latestDecision?.decidedAt ?? 0,
      )

      workflowStarts.push({
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
            : {
                candidateIdentityVersion: workflowRun.candidateIdentityVersion,
              }),
          ...(workflowRun.sourceBaseSha === undefined
            ? {}
            : { sourceBaseSha: workflowRun.sourceBaseSha }),
          ...(workflowRun.sourceCommitSha === undefined
            ? {}
            : { sourceCommitSha: workflowRun.sourceCommitSha }),
          trustState,
          updatedAt,
          createdAt: workflowRun.createdAt,
        },
      })
    }

    return workflowStarts
  },
})

export const recentWorkflowFunctions = {
  listRecent,
}
