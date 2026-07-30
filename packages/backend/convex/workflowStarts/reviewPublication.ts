import type { Doc, Id } from '../_generated/dataModel'
import { ConvexError, v } from 'convex/values'
import { mutation } from '../_generated/server'
import {
  workflowDetailVerificationRequirementLimit,
  workflowDetailReviewRunLimit,
  workflowDetailReviewFindingLimit,
  workflowDetailPolicyDecisionLimit,
  publicationResultFromDocument,
  requireWorkOSWorkspace,
  requireWorkOSIdentity,
  requireMembershipPermission,
  reviewRunKindArg,
  reviewRunStatusArg,
  reviewRunReturn,
  reviewFindingSeverityArg,
  reviewFindingCategoryArg,
  reviewFindingReturn,
  decisionStatusArg,
  policyDecisionStatusArg,
  policyDecisionReturn,
  humanDecisionReturn,
  publicationResultKindArg,
  publicationResultStatusArg,
  publicationResultReturn,
  provenanceEventStatusArg,
  provenanceEventReturn,
  requireSystemIngestionSecret,
  requireWorkflowRun,
  requireReviewRunForWorkflow,
  requireEvidenceArtifactForWorkflow,
  insertProvenanceEvent,
} from './shared'

const recordReviewRun = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    sandboxExecutionId: v.optional(v.id('sandboxExecutions')),
    candidatePatchSetId: v.optional(v.id('candidatePatchSets')),
    kind: reviewRunKindArg,
    reviewer: v.string(),
    status: reviewRunStatusArg,
    summary: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    idempotencyKey: v.string(),
    createdAt: v.optional(v.number()),
  },
  returns: reviewRunReturn,
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const workflowRun = await requireWorkflowRun(ctx, args.workflowRunId)

    if (args.sandboxExecutionId !== undefined) {
      const sandboxExecution = await ctx.db.get(
        'sandboxExecutions',
        args.sandboxExecutionId,
      )
      if (
        sandboxExecution === null ||
        sandboxExecution.workflowRunId !== args.workflowRunId
      ) {
        throw new ConvexError('Sandbox execution does not belong to workflow')
      }
    }
    if (args.candidatePatchSetId !== undefined) {
      const candidatePatchSet = await ctx.db.get(
        'candidatePatchSets',
        args.candidatePatchSetId,
      )
      if (
        candidatePatchSet === null ||
        candidatePatchSet.workflowRunId !== args.workflowRunId
      ) {
        throw new ConvexError('Candidate patch set does not belong to workflow')
      }
    }

    const existingReviewRuns = await ctx.db
      .query('reviewRuns')
      .withIndex('by_workflow_run', (q) =>
        q.eq('workflowRunId', args.workflowRunId),
      )
      .order('desc')
      .take(workflowDetailReviewRunLimit + 1)
    const existingReviewRun = existingReviewRuns.find(
      (review) => review.idempotencyKey === args.idempotencyKey,
    )
    if (existingReviewRun !== undefined) {
      if (
        existingReviewRun.sandboxExecutionId !== args.sandboxExecutionId ||
        existingReviewRun.candidatePatchSetId !== args.candidatePatchSetId ||
        existingReviewRun.kind !== args.kind ||
        existingReviewRun.reviewer !== args.reviewer ||
        existingReviewRun.status !== args.status ||
        existingReviewRun.summary !== args.summary
      ) {
        throw new ConvexError('Review run idempotency key conflict')
      }
      return {
        id: existingReviewRun._id,
        workflowRunId: existingReviewRun.workflowRunId,
        ...(existingReviewRun.sandboxExecutionId === undefined
          ? {}
          : { sandboxExecutionId: existingReviewRun.sandboxExecutionId }),
        ...(existingReviewRun.candidatePatchSetId === undefined
          ? {}
          : { candidatePatchSetId: existingReviewRun.candidatePatchSetId }),
        kind: existingReviewRun.kind,
        reviewer: existingReviewRun.reviewer,
        status: existingReviewRun.status,
        ...(existingReviewRun.summary === undefined
          ? {}
          : { summary: existingReviewRun.summary }),
        startedAt: existingReviewRun.startedAt,
        ...(existingReviewRun.completedAt === undefined
          ? {}
          : { completedAt: existingReviewRun.completedAt }),
        ...(existingReviewRun.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: existingReviewRun.idempotencyKey }),
        createdAt: existingReviewRun.createdAt,
      }
    }

    const createdAt = args.createdAt ?? Date.now()
    const reviewRun = {
      workflowRunId: args.workflowRunId,
      ...(args.sandboxExecutionId === undefined
        ? {}
        : { sandboxExecutionId: args.sandboxExecutionId }),
      ...(args.candidatePatchSetId === undefined
        ? {}
        : { candidatePatchSetId: args.candidatePatchSetId }),
      kind: args.kind,
      reviewer: args.reviewer,
      status: args.status,
      ...(args.summary === undefined ? {} : { summary: args.summary }),
      startedAt: args.startedAt,
      ...(args.completedAt === undefined
        ? {}
        : { completedAt: args.completedAt }),
      idempotencyKey: args.idempotencyKey,
      createdAt,
    }
    const id = await ctx.db.insert('reviewRuns', reviewRun)
    await insertProvenanceEvent(ctx, {
      workflowRunId: args.workflowRunId,
      traceId: workflowRun.traceId ?? 'legacy',
      type: 'review-run',
      operation: `reviewRun.${args.kind}`,
      status:
        args.status === 'failed'
          ? 'failed'
          : args.status === 'running'
            ? 'started'
            : 'succeeded',
      startedAt: args.startedAt,
      completedAt: args.completedAt ?? createdAt,
      summary: args.summary ?? `Review run ${args.kind} ${args.status}.`,
      artifactRefs: [
        String(id),
        ...(args.sandboxExecutionId === undefined
          ? []
          : [String(args.sandboxExecutionId)]),
        ...(args.candidatePatchSetId === undefined
          ? []
          : [String(args.candidatePatchSetId)]),
      ],
      idempotencyKey: `${String(id)}:review-run`,
    })

    return { id, ...reviewRun }
  },
})

const recordReviewFinding = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    reviewRunId: v.optional(v.id('reviewRuns')),
    severity: reviewFindingSeverityArg,
    category: reviewFindingCategoryArg,
    message: v.string(),
    path: v.optional(v.string()),
    startLine: v.optional(v.number()),
    endLine: v.optional(v.number()),
    evidenceArtifactId: v.optional(v.id('evidenceArtifacts')),
    idempotencyKey: v.string(),
    createdAt: v.optional(v.number()),
  },
  returns: reviewFindingReturn,
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const workflowRun = await requireWorkflowRun(ctx, args.workflowRunId)
    if (args.reviewRunId !== undefined) {
      await requireReviewRunForWorkflow(
        ctx,
        args.reviewRunId,
        args.workflowRunId,
      )
    }
    if (args.evidenceArtifactId !== undefined) {
      await requireEvidenceArtifactForWorkflow(
        ctx,
        args.evidenceArtifactId,
        args.workflowRunId,
      )
    }

    const existingFindings = await ctx.db
      .query('reviewFindings')
      .withIndex('by_workflow_run', (q) =>
        q.eq('workflowRunId', args.workflowRunId),
      )
      .order('desc')
      .take(workflowDetailReviewFindingLimit + 1)
    const existingFinding = existingFindings.find(
      (finding) => finding.idempotencyKey === args.idempotencyKey,
    )
    if (existingFinding !== undefined) {
      if (
        existingFinding.reviewRunId !== args.reviewRunId ||
        existingFinding.severity !== args.severity ||
        existingFinding.category !== args.category ||
        existingFinding.message !== args.message ||
        existingFinding.path !== args.path ||
        existingFinding.startLine !== args.startLine ||
        existingFinding.endLine !== args.endLine ||
        existingFinding.evidenceArtifactId !== args.evidenceArtifactId
      ) {
        throw new ConvexError('Review finding idempotency key conflict')
      }
      return {
        id: existingFinding._id,
        workflowRunId: existingFinding.workflowRunId,
        ...(existingFinding.reviewRunId === undefined
          ? {}
          : { reviewRunId: existingFinding.reviewRunId }),
        severity: existingFinding.severity,
        category: existingFinding.category,
        message: existingFinding.message,
        ...(existingFinding.path === undefined
          ? {}
          : { path: existingFinding.path }),
        ...(existingFinding.startLine === undefined
          ? {}
          : { startLine: existingFinding.startLine }),
        ...(existingFinding.endLine === undefined
          ? {}
          : { endLine: existingFinding.endLine }),
        ...(existingFinding.evidenceArtifactId === undefined
          ? {}
          : { evidenceArtifactId: existingFinding.evidenceArtifactId }),
        ...(existingFinding.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: existingFinding.idempotencyKey }),
        createdAt: existingFinding.createdAt,
      }
    }

    const createdAt = args.createdAt ?? Date.now()
    const finding = {
      workflowRunId: args.workflowRunId,
      ...(args.reviewRunId === undefined
        ? {}
        : { reviewRunId: args.reviewRunId }),
      severity: args.severity,
      category: args.category,
      message: args.message,
      ...(args.path === undefined ? {} : { path: args.path }),
      ...(args.startLine === undefined ? {} : { startLine: args.startLine }),
      ...(args.endLine === undefined ? {} : { endLine: args.endLine }),
      ...(args.evidenceArtifactId === undefined
        ? {}
        : { evidenceArtifactId: args.evidenceArtifactId }),
      idempotencyKey: args.idempotencyKey,
      createdAt,
    }
    const id = await ctx.db.insert('reviewFindings', finding)
    await insertProvenanceEvent(ctx, {
      workflowRunId: args.workflowRunId,
      traceId: workflowRun.traceId ?? 'legacy',
      type: 'review-finding',
      operation: `reviewFinding.${args.category}`,
      status:
        args.severity === 'critical' || args.severity === 'error'
          ? 'failed'
          : 'succeeded',
      startedAt: createdAt,
      completedAt: createdAt,
      summary: args.message,
      artifactRefs: [
        String(id),
        ...(args.reviewRunId === undefined ? [] : [String(args.reviewRunId)]),
        ...(args.evidenceArtifactId === undefined
          ? []
          : [String(args.evidenceArtifactId)]),
      ],
      idempotencyKey: `${String(id)}:review-finding`,
    })

    return { id, ...finding }
  },
})

const recordPolicyDecision = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    reviewRunId: v.optional(v.id('reviewRuns')),
    candidatePatchSetId: v.optional(v.id('candidatePatchSets')),
    status: policyDecisionStatusArg,
    summary: v.string(),
    reason: v.optional(v.string()),
    policyVersion: v.optional(v.string()),
    inputDigest: v.optional(v.string()),
    verificationResultIds: v.optional(v.array(v.id('verificationResults'))),
    reviewFindingIds: v.optional(v.array(v.id('reviewFindings'))),
    missingRequirementIds: v.optional(
      v.array(v.id('verificationRequirements')),
    ),
    idempotencyKey: v.string(),
    createdAt: v.optional(v.number()),
  },
  returns: policyDecisionReturn,
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const workflowRun = await requireWorkflowRun(ctx, args.workflowRunId)
    if (workflowRun.status === 'failed') {
      throw new ConvexError(
        'Failed workflow attempts cannot record policy decisions',
      )
    }
    const reviewRun =
      args.reviewRunId === undefined
        ? undefined
        : await requireReviewRunForWorkflow(
            ctx,
            args.reviewRunId,
            args.workflowRunId,
          )
    if (
      (args.verificationResultIds?.length ?? 0) > 128 ||
      (args.reviewFindingIds?.length ?? 0) > 128 ||
      (args.missingRequirementIds?.length ?? 0) > 64
    ) {
      throw new ConvexError('Policy evidence references exceed limit')
    }
    if (
      workflowRun.modelVersion === 'v1' &&
      (args.reviewRunId === undefined ||
        args.candidatePatchSetId === undefined ||
        args.policyVersion === undefined ||
        args.inputDigest === undefined ||
        !/^sha256:[0-9a-f]{64}$/.test(args.inputDigest))
    ) {
      throw new ConvexError(
        'V1 policy decisions require candidate-bound, versioned, digested inputs',
      )
    }
    if (
      workflowRun.modelVersion === 'v1' &&
      reviewRun?.status !== 'completed'
    ) {
      throw new ConvexError('V1 policy decisions require a completed review')
    }

    const [
      candidate,
      verificationResults,
      reviewFindings,
      missingRequirements,
    ] = await Promise.all([
      args.candidatePatchSetId === undefined
        ? Promise.resolve(null)
        : ctx.db.get('candidatePatchSets', args.candidatePatchSetId),
      Promise.all(
        (args.verificationResultIds ?? []).map((id) =>
          ctx.db.get('verificationResults', id),
        ),
      ),
      Promise.all(
        (args.reviewFindingIds ?? []).map((id) =>
          ctx.db.get('reviewFindings', id),
        ),
      ),
      Promise.all(
        (args.missingRequirementIds ?? []).map((id) =>
          ctx.db.get('verificationRequirements', id),
        ),
      ),
    ])
    if (
      args.candidatePatchSetId !== undefined &&
      (candidate === null || candidate.workflowRunId !== args.workflowRunId)
    ) {
      throw new ConvexError('Policy candidate does not belong to workflow')
    }
    if (
      verificationResults.some(
        (result) =>
          result === null || result.workflowRunId !== args.workflowRunId,
      )
    ) {
      throw new ConvexError(
        'Policy verification result does not belong to workflow',
      )
    }
    if (
      reviewFindings.some(
        (finding) =>
          finding === null ||
          finding.workflowRunId !== args.workflowRunId ||
          finding.reviewRunId !== args.reviewRunId,
      )
    ) {
      throw new ConvexError('Policy review finding does not belong to review')
    }
    if (workflowRun.modelVersion === 'v1' && args.reviewRunId !== undefined) {
      const reviewFindingPage = await ctx.db
        .query('reviewFindings')
        .withIndex('by_review_run', (q) =>
          q.eq('reviewRunId', args.reviewRunId),
        )
        .take(workflowDetailReviewFindingLimit + 1)
      if (
        reviewFindingPage.length > workflowDetailReviewFindingLimit ||
        reviewFindingPage.length !== reviewFindings.length ||
        reviewFindingPage.some(
          (finding) => !args.reviewFindingIds?.includes(finding._id),
        )
      ) {
        throw new ConvexError(
          'V1 policy input must include every review finding',
        )
      }
    }
    if (
      missingRequirements.some(
        (requirement) =>
          requirement === null ||
          requirement.workflowRunId !== args.workflowRunId,
      )
    ) {
      throw new ConvexError(
        'Policy verification requirement does not belong to workflow',
      )
    }
    if (
      args.candidatePatchSetId !== undefined &&
      (reviewRun?.candidatePatchSetId !== args.candidatePatchSetId ||
        verificationResults.some(
          (result) => result?.candidatePatchSetId !== args.candidatePatchSetId,
        ))
    ) {
      throw new ConvexError('Policy evidence must reference one candidate')
    }
    const requiredRequirementPage = await ctx.db
      .query('verificationRequirements')
      .withIndex('by_workflow_run', (q) =>
        q.eq('workflowRunId', args.workflowRunId),
      )
      .take(workflowDetailVerificationRequirementLimit + 1)
    if (
      requiredRequirementPage.length >
      workflowDetailVerificationRequirementLimit
    ) {
      throw new ConvexError(
        'Verification requirements exceed policy evaluation limit',
      )
    }
    const expectedMissingRequirementIds = requiredRequirementPage
      .filter((requirement) => {
        if (!requirement.required) return false
        const result = verificationResults
          .filter(
            (candidateResult) =>
              candidateResult?.requirementId === requirement._id,
          )
          .reduce<(typeof verificationResults)[number] | undefined>(
            (latest, candidateResult) => {
              if (candidateResult === null) return latest
              if (latest === undefined || latest === null)
                return candidateResult
              return (candidateResult.completedAt ??
                candidateResult.startedAt) >
                (latest.completedAt ?? latest.startedAt)
                ? candidateResult
                : latest
            },
            undefined,
          )
        return (
          result === undefined ||
          result === null ||
          (result.status !== 'passed' && result.status !== 'failed')
        )
      })
      .map((requirement) => String(requirement._id))
      .toSorted()
    const suppliedMissingRequirementIds = (args.missingRequirementIds ?? [])
      .map(String)
      .toSorted()
    if (
      JSON.stringify(expectedMissingRequirementIds) !==
      JSON.stringify(suppliedMissingRequirementIds)
    ) {
      throw new ConvexError(
        'Policy missing requirements do not match persisted verification evidence',
      )
    }

    const existingPolicyDecisions = await ctx.db
      .query('policyDecisions')
      .withIndex('by_workflow_run', (q) =>
        q.eq('workflowRunId', args.workflowRunId),
      )
      .order('desc')
      .take(workflowDetailPolicyDecisionLimit + 1)
    const existingPolicyDecision = existingPolicyDecisions.find(
      (decision) => decision.idempotencyKey === args.idempotencyKey,
    )
    if (existingPolicyDecision !== undefined) {
      if (
        existingPolicyDecision.reviewRunId !== args.reviewRunId ||
        existingPolicyDecision.candidatePatchSetId !==
          args.candidatePatchSetId ||
        existingPolicyDecision.status !== args.status ||
        existingPolicyDecision.summary !== args.summary ||
        existingPolicyDecision.reason !== args.reason ||
        existingPolicyDecision.policyVersion !== args.policyVersion ||
        existingPolicyDecision.inputDigest !== args.inputDigest ||
        JSON.stringify(existingPolicyDecision.verificationResultIds) !==
          JSON.stringify(args.verificationResultIds) ||
        JSON.stringify(existingPolicyDecision.reviewFindingIds) !==
          JSON.stringify(args.reviewFindingIds) ||
        JSON.stringify(existingPolicyDecision.missingRequirementIds) !==
          JSON.stringify(args.missingRequirementIds)
      ) {
        throw new ConvexError('Policy decision idempotency key conflict')
      }
      return {
        id: existingPolicyDecision._id,
        workflowRunId: existingPolicyDecision.workflowRunId,
        ...(existingPolicyDecision.reviewRunId === undefined
          ? {}
          : { reviewRunId: existingPolicyDecision.reviewRunId }),
        ...(existingPolicyDecision.candidatePatchSetId === undefined
          ? {}
          : {
              candidatePatchSetId: existingPolicyDecision.candidatePatchSetId,
            }),
        status: existingPolicyDecision.status,
        summary: existingPolicyDecision.summary,
        ...(existingPolicyDecision.reason === undefined
          ? {}
          : { reason: existingPolicyDecision.reason }),
        ...(existingPolicyDecision.policyVersion === undefined
          ? {}
          : { policyVersion: existingPolicyDecision.policyVersion }),
        ...(existingPolicyDecision.inputDigest === undefined
          ? {}
          : { inputDigest: existingPolicyDecision.inputDigest }),
        ...(existingPolicyDecision.verificationResultIds === undefined
          ? {}
          : {
              verificationResultIds:
                existingPolicyDecision.verificationResultIds,
            }),
        ...(existingPolicyDecision.reviewFindingIds === undefined
          ? {}
          : { reviewFindingIds: existingPolicyDecision.reviewFindingIds }),
        ...(existingPolicyDecision.missingRequirementIds === undefined
          ? {}
          : {
              missingRequirementIds:
                existingPolicyDecision.missingRequirementIds,
            }),
        ...(existingPolicyDecision.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: existingPolicyDecision.idempotencyKey }),
        createdAt: existingPolicyDecision.createdAt,
      }
    }

    if (workflowRun.modelVersion === 'v1' && workflowRun.status !== 'running') {
      throw new ConvexError(
        'V1 policy decision requires an active workflow execution',
      )
    }

    const createdAt = args.createdAt ?? Date.now()
    const decision = {
      workflowRunId: args.workflowRunId,
      ...(args.reviewRunId === undefined
        ? {}
        : { reviewRunId: args.reviewRunId }),
      ...(args.candidatePatchSetId === undefined
        ? {}
        : { candidatePatchSetId: args.candidatePatchSetId }),
      status: args.status,
      summary: args.summary,
      ...(args.reason === undefined ? {} : { reason: args.reason }),
      ...(args.policyVersion === undefined
        ? {}
        : { policyVersion: args.policyVersion }),
      ...(args.inputDigest === undefined
        ? {}
        : { inputDigest: args.inputDigest }),
      ...(args.verificationResultIds === undefined
        ? {}
        : { verificationResultIds: args.verificationResultIds }),
      ...(args.reviewFindingIds === undefined
        ? {}
        : { reviewFindingIds: args.reviewFindingIds }),
      ...(args.missingRequirementIds === undefined
        ? {}
        : { missingRequirementIds: args.missingRequirementIds }),
      idempotencyKey: args.idempotencyKey,
      createdAt,
    }
    const id = await ctx.db.insert('policyDecisions', decision)
    if (workflowRun.status !== 'reviewed') {
      await ctx.db.patch('workflowRuns', args.workflowRunId, {
        status: 'reviewed',
      })
    }
    await insertProvenanceEvent(ctx, {
      workflowRunId: args.workflowRunId,
      traceId: workflowRun.traceId ?? 'legacy',
      type: 'policy-decision',
      operation: 'policyDecision.recorded',
      status:
        args.status === 'approved'
          ? 'succeeded'
          : args.status === 'manual-review'
            ? 'blocked'
            : 'failed',
      startedAt: createdAt,
      completedAt: createdAt,
      summary: args.summary,
      artifactRefs: [
        String(id),
        ...(args.reviewRunId === undefined ? [] : [String(args.reviewRunId)]),
      ],
      idempotencyKey: `${String(id)}:policy-decision`,
    })

    return { id, ...decision }
  },
})

const recordPublicationResult = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    humanDecisionId: v.optional(v.id('humanDecisions')),
    candidatePatchSetId: v.optional(v.id('candidatePatchSets')),
    targetSha: v.optional(v.string()),
    provider: v.string(),
    kind: publicationResultKindArg,
    status: publicationResultStatusArg,
    externalId: v.optional(v.string()),
    url: v.optional(v.string()),
    summary: v.optional(v.string()),
    error: v.optional(v.string()),
    dispatchToken: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    idempotencyKey: v.optional(v.string()),
  },
  returns: publicationResultReturn,
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const workflowRun = await requireWorkflowRun(ctx, args.workflowRunId)
    const [humanDecision, candidatePatchSet] = await Promise.all([
      args.humanDecisionId === undefined
        ? Promise.resolve(null)
        : ctx.db.get('humanDecisions', args.humanDecisionId),
      args.candidatePatchSetId === undefined
        ? Promise.resolve(null)
        : ctx.db.get('candidatePatchSets', args.candidatePatchSetId),
    ])
    if (
      args.humanDecisionId !== undefined &&
      (humanDecision === null ||
        humanDecision.workflowRunId !== args.workflowRunId)
    ) {
      throw new ConvexError(
        'Publication human decision does not belong to workflow',
      )
    }
    if (
      args.candidatePatchSetId !== undefined &&
      (candidatePatchSet === null ||
        candidatePatchSet.workflowRunId !== args.workflowRunId)
    ) {
      throw new ConvexError('Publication candidate does not belong to workflow')
    }
    if (
      workflowRun.modelVersion === 'v1' &&
      (humanDecision === null ||
        candidatePatchSet === null ||
        humanDecision.candidatePatchSetId !== candidatePatchSet._id)
    ) {
      throw new ConvexError(
        'V1 publication requires directly linked decision and candidate',
      )
    }
    if (
      args.kind === 'check-run' &&
      (args.targetSha === undefined ||
        candidatePatchSet?.headSha !== args.targetSha)
    ) {
      throw new ConvexError(
        'Check publication target must match the materialized candidate commit',
      )
    }

    const requestedAt = args.createdAt ?? Date.now()
    let canonicalDispatchToken = args.dispatchToken
    let canonicalClaimId: Id<'canonicalPublicationClaims'> | undefined
    if (workflowRun.modelVersion === 'v1') {
      if (
        args.humanDecisionId === undefined ||
        args.dispatchToken === undefined
      ) {
        throw new ConvexError(
          'V1 publication requires a decision and dispatch token',
        )
      }
      const rootWorkflowRunId = workflowRun.rootWorkflowRunId ?? workflowRun._id
      const [latestChildAttempt, latestHumanDecision, canonicalClaim] =
        await Promise.all([
          ctx.db
            .query('workflowRuns')
            .withIndex('by_root_attempt', (q) =>
              q.eq('rootWorkflowRunId', rootWorkflowRunId),
            )
            .order('desc')
            .first(),
          ctx.db
            .query('humanDecisions')
            .withIndex('by_workflow_run', (q) =>
              q.eq('workflowRunId', workflowRun._id),
            )
            .order('desc')
            .first(),
          ctx.db
            .query('canonicalPublicationClaims')
            .withIndex('by_root_kind', (q) =>
              q
                .eq('rootWorkflowRunId', rootWorkflowRunId)
                .eq('kind', args.kind),
            )
            .unique(),
        ])
      if ((latestChildAttempt?._id ?? rootWorkflowRunId) !== workflowRun._id) {
        throw new ConvexError('Superseded workflow attempt cannot publish')
      }
      if (latestHumanDecision?._id !== args.humanDecisionId) {
        throw new ConvexError('Stale human decision cannot publish')
      }
      if (args.status === 'pending') {
        if (
          canonicalClaim !== null &&
          canonicalClaim.dispatchToken !== args.dispatchToken &&
          requestedAt - canonicalClaim.leasedAt < 300_000
        ) {
          canonicalDispatchToken = undefined
        } else if (canonicalClaim === null) {
          canonicalClaimId = await ctx.db.insert('canonicalPublicationClaims', {
            rootWorkflowRunId,
            kind: args.kind,
            workflowRunId: workflowRun._id,
            humanDecisionId: args.humanDecisionId,
            dispatchToken: args.dispatchToken,
            leasedAt: requestedAt,
          })
        } else {
          canonicalClaimId = canonicalClaim._id
          await ctx.db.patch('canonicalPublicationClaims', canonicalClaim._id, {
            workflowRunId: workflowRun._id,
            humanDecisionId: args.humanDecisionId,
            dispatchToken: args.dispatchToken,
            leasedAt: requestedAt,
          })
        }
      } else {
        if (
          canonicalClaim === null ||
          canonicalClaim.dispatchToken !== args.dispatchToken
        ) {
          throw new ConvexError('Canonical publication dispatch lease lost')
        }
        canonicalClaimId = canonicalClaim._id
      }
    }

    if (args.idempotencyKey !== undefined) {
      const existing = await ctx.db
        .query('publicationResults')
        .withIndex('by_workflow_publication_key', (q) =>
          q
            .eq('workflowRunId', args.workflowRunId)
            .eq('idempotencyKey', args.idempotencyKey),
        )
        .unique()

      if (existing !== null) {
        if (
          existing.status === 'pending' &&
          existing.dispatchToken !== undefined &&
          args.status === 'pending' &&
          existing.dispatchToken !== args.dispatchToken &&
          requestedAt - existing.createdAt < 300_000
        ) {
          return publicationResultFromDocument(existing)
        }
        if (existing.status === 'published') {
          return publicationResultFromDocument(existing)
        }

        if (
          existing.humanDecisionId !== args.humanDecisionId ||
          existing.candidatePatchSetId !== args.candidatePatchSetId ||
          existing.targetSha !== args.targetSha
        ) {
          throw new ConvexError('Publication idempotency key conflict')
        }
        if (
          args.status !== 'pending' &&
          existing.dispatchToken !== undefined &&
          args.dispatchToken !== existing.dispatchToken
        ) {
          throw new ConvexError('Publication dispatch lease lost')
        }
        const createdAt = args.createdAt ?? Date.now()
        const updated = {
          ...(args.humanDecisionId === undefined
            ? {}
            : { humanDecisionId: args.humanDecisionId }),
          ...(args.candidatePatchSetId === undefined
            ? {}
            : { candidatePatchSetId: args.candidatePatchSetId }),
          ...(args.targetSha === undefined
            ? {}
            : { targetSha: args.targetSha }),
          provider: args.provider,
          kind: args.kind,
          status: args.status,
          externalId: args.externalId,
          url: args.url,
          summary: args.summary,
          error: args.error,
          dispatchToken: canonicalDispatchToken,
          createdAt,
          idempotencyKey: args.idempotencyKey,
        }
        await ctx.db.patch('publicationResults', existing._id, updated)
        await insertProvenanceEvent(ctx, {
          workflowRunId: args.workflowRunId,
          traceId: workflowRun.traceId ?? 'legacy',
          type: 'publication-result',
          operation: `publicationResult.${args.kind}.retry`,
          pluginName: args.provider,
          status:
            args.status === 'published'
              ? 'succeeded'
              : args.status === 'pending'
                ? 'started'
                : 'failed',
          startedAt: createdAt,
          completedAt: createdAt,
          summary: args.summary ?? `Publication ${args.kind} ${args.status}.`,
          artifactRefs: [String(existing._id)],
          errorCategory: args.error === undefined ? undefined : 'publication',
          idempotencyKey: `${args.idempotencyKey}:provenance:${args.status}`,
        })
        if (canonicalClaimId !== undefined && args.status !== 'pending') {
          await ctx.db.delete('canonicalPublicationClaims', canonicalClaimId)
        }
        return {
          id: existing._id,
          workflowRunId: existing.workflowRunId,
          ...updated,
        }
      }
    }

    const createdAt = args.createdAt ?? Date.now()
    const result = {
      workflowRunId: args.workflowRunId,
      ...(args.humanDecisionId === undefined
        ? {}
        : { humanDecisionId: args.humanDecisionId }),
      ...(args.candidatePatchSetId === undefined
        ? {}
        : { candidatePatchSetId: args.candidatePatchSetId }),
      ...(args.targetSha === undefined ? {} : { targetSha: args.targetSha }),
      provider: args.provider,
      kind: args.kind,
      status: args.status,
      ...(args.externalId === undefined ? {} : { externalId: args.externalId }),
      ...(args.url === undefined ? {} : { url: args.url }),
      ...(args.summary === undefined ? {} : { summary: args.summary }),
      ...(args.error === undefined ? {} : { error: args.error }),
      ...(canonicalDispatchToken === undefined
        ? {}
        : { dispatchToken: canonicalDispatchToken }),
      createdAt,
      ...(args.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: args.idempotencyKey }),
    }
    const id = await ctx.db.insert('publicationResults', result)
    await insertProvenanceEvent(ctx, {
      workflowRunId: args.workflowRunId,
      traceId: workflowRun.traceId ?? 'legacy',
      type: 'publication-result',
      operation: `publicationResult.${args.kind}`,
      pluginName: args.provider,
      status:
        args.status === 'published'
          ? 'succeeded'
          : args.status === 'pending'
            ? 'started'
            : 'failed',
      startedAt: createdAt,
      completedAt: createdAt,
      summary: args.summary ?? `Publication ${args.kind} ${args.status}.`,
      artifactRefs: [String(id)],
      errorCategory: args.error === undefined ? undefined : 'publication',
      idempotencyKey:
        args.idempotencyKey === undefined
          ? `${String(id)}:publication-result`
          : `${args.idempotencyKey}:provenance`,
    })

    return { id, ...result }
  },
})

const recordProvenanceEvent = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    traceId: v.string(),
    parentEventId: v.optional(v.string()),
    type: v.string(),
    operation: v.string(),
    pluginName: v.optional(v.string()),
    status: provenanceEventStatusArg,
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    summary: v.optional(v.string()),
    artifactRefs: v.array(v.string()),
    errorCategory: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
  },
  returns: provenanceEventReturn,
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    await requireWorkflowRun(ctx, args.workflowRunId)

    return insertProvenanceEvent(ctx, {
      workflowRunId: args.workflowRunId,
      traceId: args.traceId,
      ...(args.parentEventId === undefined
        ? {}
        : { parentEventId: args.parentEventId }),
      type: args.type,
      operation: args.operation,
      ...(args.pluginName === undefined ? {} : { pluginName: args.pluginName }),
      status: args.status,
      startedAt: args.startedAt,
      ...(args.completedAt === undefined
        ? {}
        : { completedAt: args.completedAt }),
      ...(args.summary === undefined ? {} : { summary: args.summary }),
      artifactRefs: args.artifactRefs,
      ...(args.errorCategory === undefined
        ? {}
        : { errorCategory: args.errorCategory }),
      ...(args.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: args.idempotencyKey }),
    })
  },
})

const recordHumanDecision = mutation({
  args: {
    workflowRunId: v.id('workflowRuns'),
    sandboxExecutionId: v.optional(v.id('sandboxExecutions')),
    candidatePatchSetId: v.optional(v.id('candidatePatchSets')),
    reviewRunId: v.optional(v.id('reviewRuns')),
    policyDecisionId: v.optional(v.id('policyDecisions')),
    status: decisionStatusArg,
    comment: v.string(),
    verificationOverrideReason: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
  },
  returns: humanDecisionReturn,
  handler: async (ctx, args) => {
    const comment = args.comment.trim()
    const verificationOverrideReason = args.verificationOverrideReason?.trim()
    if (comment.length === 0) {
      throw new ConvexError('Decision comment required')
    }
    if (
      verificationOverrideReason !== undefined &&
      (verificationOverrideReason.length === 0 ||
        verificationOverrideReason.length > 1_000)
    ) {
      throw new ConvexError(
        'Verification override reason must contain 1 to 1000 characters',
      )
    }

    const identity = await requireWorkOSIdentity(ctx)
    const workflowRun = await requireWorkflowRun(ctx, args.workflowRunId)
    requireWorkOSWorkspace(identity, workflowRun.workspaceId)
    await requireMembershipPermission(
      ctx,
      identity,
      workflowRun.workspaceId,
      args.status === 'approved' ? 'decision:approve' : 'decision:reject',
    )

    let existingDecision: Doc<'humanDecisions'> | null = null
    if (args.idempotencyKey !== undefined) {
      existingDecision = await ctx.db
        .query('humanDecisions')
        .withIndex('by_workflow_decision_key', (q) =>
          q
            .eq('workflowRunId', args.workflowRunId)
            .eq('idempotencyKey', args.idempotencyKey),
        )
        .unique()

      if (
        existingDecision !== null &&
        (existingDecision.status !== args.status ||
          existingDecision.comment !== comment ||
          existingDecision.sandboxExecutionId !== args.sandboxExecutionId ||
          existingDecision.candidatePatchSetId !== args.candidatePatchSetId ||
          existingDecision.reviewRunId !== args.reviewRunId ||
          existingDecision.policyDecisionId !== args.policyDecisionId ||
          existingDecision.verificationOverrideReason !==
            verificationOverrideReason)
      ) {
        throw new ConvexError('Human decision idempotency key conflict')
      }
    }

    if (existingDecision === null && workflowRun.modelVersion === 'v1') {
      const latestAttempt = await ctx.db
        .query('workflowRuns')
        .withIndex('by_root_attempt', (q) =>
          q.eq(
            'rootWorkflowRunId',
            workflowRun.rootWorkflowRunId ?? workflowRun._id,
          ),
        )
        .order('desc')
        .first()
      if (latestAttempt !== null && latestAttempt._id !== workflowRun._id) {
        throw new ConvexError('A newer workflow attempt supersedes this report')
      }
      const activePublications = await ctx.db
        .query('canonicalPublicationClaims')
        .withIndex('by_root', (q) =>
          q.eq(
            'rootWorkflowRunId',
            workflowRun.rootWorkflowRunId ?? workflowRun._id,
          ),
        )
        .take(5)
      if (
        activePublications.some(
          (publication) => Date.now() - publication.leasedAt < 300_000,
        )
      ) {
        throw new ConvexError(
          'Workflow publication is in progress; retry the decision',
        )
      }
    }

    if (
      args.sandboxExecutionId === undefined ||
      args.candidatePatchSetId === undefined ||
      args.reviewRunId === undefined ||
      args.policyDecisionId === undefined
    ) {
      throw new ConvexError('Displayed review projection IDs required')
    }

    const [
      sandboxExecution,
      candidatePatchSet,
      reviewRun,
      policyDecision,
      sandboxExecutions,
      candidatePatchSets,
      reviewRuns,
      policyDecisions,
    ] = await Promise.all([
      ctx.db.get('sandboxExecutions', args.sandboxExecutionId),
      ctx.db.get('candidatePatchSets', args.candidatePatchSetId),
      ctx.db.get('reviewRuns', args.reviewRunId),
      ctx.db.get('policyDecisions', args.policyDecisionId),
      ctx.db
        .query('sandboxExecutions')
        .withIndex('by_workflow_run', (q) =>
          q.eq('workflowRunId', args.workflowRunId),
        )
        .order('desc')
        .take(32),
      ctx.db
        .query('candidatePatchSets')
        .withIndex('by_workflow_run', (q) =>
          q.eq('workflowRunId', args.workflowRunId),
        )
        .order('desc')
        .take(32),
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
    ])
    if (
      sandboxExecution === null ||
      sandboxExecution.workflowRunId !== args.workflowRunId
    ) {
      throw new ConvexError('Sandbox execution does not belong to workflow')
    }
    if (
      candidatePatchSet === null ||
      candidatePatchSet.workflowRunId !== args.workflowRunId
    ) {
      throw new ConvexError('Candidate patch set does not belong to workflow')
    }
    if (reviewRun === null || reviewRun.workflowRunId !== args.workflowRunId) {
      throw new ConvexError('Review run does not belong to workflow')
    }
    if (
      policyDecision === null ||
      policyDecision.workflowRunId !== args.workflowRunId
    ) {
      throw new ConvexError('Policy decision does not belong to workflow')
    }

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
    if (
      latestSandboxExecution?._id !== sandboxExecution._id ||
      latestCandidatePatchSet?._id !== candidatePatchSet._id ||
      latestReviewRun?._id !== reviewRun._id ||
      latestPolicyDecision?._id !== policyDecision._id
    ) {
      throw new ConvexError('Displayed review projection is stale')
    }

    if (workflowRun.status !== 'reviewed') {
      throw new ConvexError(
        'Workflow must finish verification before a human decision',
      )
    }
    if (
      args.status === 'approved' &&
      (sandboxExecution.status !== 'succeeded' ||
        candidatePatchSet.status !== 'captured' ||
        reviewRun.status !== 'completed' ||
        policyDecision.status === 'rejected' ||
        policyDecision.status === 'changes-requested')
    ) {
      throw new ConvexError(
        'Approval requires successful execution, a captured candidate, completed review, and non-blocking policy',
      )
    }
    if (candidatePatchSet.createdAt < sandboxExecution.completedAt) {
      throw new ConvexError(
        'Candidate patch set predates latest sandbox execution',
      )
    }
    if (
      reviewRun.sandboxExecutionId !== sandboxExecution._id ||
      reviewRun.candidatePatchSetId !== candidatePatchSet._id
    ) {
      throw new ConvexError(
        'Review run must reference displayed sandbox and candidate patch',
      )
    }
    if (policyDecision.reviewRunId !== reviewRun._id) {
      throw new ConvexError('Policy decision must reference latest review run')
    }
    if (
      workflowRun.modelVersion === 'v1' &&
      policyDecision.candidatePatchSetId !== candidatePatchSet._id
    ) {
      throw new ConvexError(
        'Policy decision must reference the displayed candidate',
      )
    }

    const requiredRequirementPage = await ctx.db
      .query('verificationRequirements')
      .withIndex('by_workflow_run', (q) =>
        q.eq('workflowRunId', args.workflowRunId),
      )
      .take(workflowDetailVerificationRequirementLimit + 1)
    if (
      requiredRequirementPage.length >
      workflowDetailVerificationRequirementLimit
    ) {
      throw new ConvexError(
        'Verification requirements exceed decision evaluation limit',
      )
    }
    const requiredRequirements = requiredRequirementPage.filter(
      (requirement) => requirement.required,
    )
    const policyVerificationResults = await Promise.all(
      (policyDecision.verificationResultIds ?? []).map((resultId) =>
        ctx.db.get('verificationResults', resultId),
      ),
    )
    const verificationComplete =
      requiredRequirements.length > 0 &&
      (policyDecision.missingRequirementIds?.length ?? 0) === 0 &&
      requiredRequirements.every((requirement) =>
        policyVerificationResults.some(
          (result) =>
            result !== null &&
            result.requirementId === requirement._id &&
            result.candidatePatchSetId === candidatePatchSet._id &&
            result.status === 'passed',
        ),
      )
    const verificationOverride =
      args.status === 'approved' && !verificationComplete
    if (verificationOverride && verificationOverrideReason === undefined) {
      throw new ConvexError(
        'Approval with incomplete verification requires an explicit override reason',
      )
    }

    if (existingDecision !== null) {
      return {
        id: existingDecision._id,
        workflowRunId: existingDecision.workflowRunId,
        ...(existingDecision.sandboxExecutionId === undefined
          ? {}
          : { sandboxExecutionId: existingDecision.sandboxExecutionId }),
        ...(existingDecision.candidatePatchSetId === undefined
          ? {}
          : { candidatePatchSetId: existingDecision.candidatePatchSetId }),
        ...(existingDecision.reviewRunId === undefined
          ? {}
          : { reviewRunId: existingDecision.reviewRunId }),
        ...(existingDecision.policyDecisionId === undefined
          ? {}
          : { policyDecisionId: existingDecision.policyDecisionId }),
        actorId: existingDecision.actorId,
        status: existingDecision.status,
        comment: existingDecision.comment,
        ...(existingDecision.verificationOverride === undefined
          ? {}
          : { verificationOverride: existingDecision.verificationOverride }),
        ...(existingDecision.verificationOverrideReason === undefined
          ? {}
          : {
              verificationOverrideReason:
                existingDecision.verificationOverrideReason,
            }),
        decidedAt: existingDecision.decidedAt,
        ...(existingDecision.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: existingDecision.idempotencyKey }),
      }
    }

    const decision = {
      workflowRunId: args.workflowRunId,
      sandboxExecutionId: sandboxExecution._id,
      candidatePatchSetId: candidatePatchSet._id,
      reviewRunId: reviewRun._id,
      policyDecisionId: policyDecision._id,
      actorId: `workos:${identity.subject}`,
      status: args.status,
      comment,
      ...(verificationOverride
        ? { verificationOverride: true, verificationOverrideReason }
        : {}),
      decidedAt: Date.now(),
      ...(args.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: args.idempotencyKey }),
    }
    const id = await ctx.db.insert('humanDecisions', decision)
    await insertProvenanceEvent(ctx, {
      workflowRunId: args.workflowRunId,
      traceId: workflowRun.traceId ?? 'legacy',
      type: 'human-decision',
      operation: 'humanDecision.recorded',
      status:
        args.status === 'approved'
          ? 'succeeded'
          : args.status === 'changes-requested'
            ? 'blocked'
            : 'failed',
      startedAt: decision.decidedAt,
      completedAt: decision.decidedAt,
      summary: comment,
      artifactRefs: [String(id)],
      idempotencyKey: `${String(id)}:human-decision`,
    })

    return { id, ...decision }
  },
})

export const reviewPublicationFunctions = {
  recordReviewRun,
  recordReviewFinding,
  recordPolicyDecision,
  recordPublicationResult,
  recordProvenanceEvent,
  recordHumanDecision,
} as const
