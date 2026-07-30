import { ConvexError, v } from 'convex/values'
import { query } from '../../_generated/server'
import {
  workflowDetailVerificationRequirementLimit,
  workflowDetailEvidenceArtifactLimit,
  workflowDetailReviewFindingLimit,
  sandboxOutputPreview,
  decisionPublicationReplayFixtureReturn,
  requireSystemIngestionSecret,
  requireWorkflowRun,
} from '../shared'

const getDecisionPublicationReplayFixture = query({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    humanDecisionId: v.id('humanDecisions'),
  },
  returns: decisionPublicationReplayFixtureReturn,
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const workflowRun = await requireWorkflowRun(ctx, args.workflowRunId)
    if (workflowRun.modelVersion !== 'v1') {
      throw new ConvexError(
        'Decision publication requires a V1 workflow attempt',
      )
    }
    const rootWorkflowRunId = workflowRun.rootWorkflowRunId ?? workflowRun._id
    const latestChildAttempt = await ctx.db
      .query('workflowRuns')
      .withIndex('by_root_attempt', (q) =>
        q.eq('rootWorkflowRunId', rootWorkflowRunId),
      )
      .order('desc')
      .first()
    const latestAttemptId = latestChildAttempt?._id ?? rootWorkflowRunId
    if (latestAttemptId !== workflowRun._id) {
      throw new ConvexError(
        'Only the latest workflow attempt may update the canonical Patch Report',
      )
    }
    const latestHumanDecision = await ctx.db
      .query('humanDecisions')
      .withIndex('by_workflow_run', (q) =>
        q.eq('workflowRunId', workflowRun._id),
      )
      .order('desc')
      .first()
    const humanDecision = await ctx.db.get(
      'humanDecisions',
      args.humanDecisionId,
    )

    if (
      humanDecision === null ||
      humanDecision.workflowRunId !== args.workflowRunId ||
      latestHumanDecision?._id !== humanDecision._id
    ) {
      throw new ConvexError('Human decision not found')
    }

    const publicationKeys = [
      `${String(args.humanDecisionId)}:issue-comment`,
      `${String(args.humanDecisionId)}:check-run`,
    ] as const
    const [promptRequest, candidatePatchSets, correlatedCandidatePatchSet] =
      await Promise.all([
        ctx.db.get('promptRequests', workflowRun.promptRequestId),
        ctx.db
          .query('candidatePatchSets')
          .withIndex('by_workflow_run', (q) =>
            q.eq('workflowRunId', args.workflowRunId),
          )
          .order('desc')
          .take(32),
        humanDecision.candidatePatchSetId === undefined
          ? Promise.resolve(null)
          : ctx.db.get('candidatePatchSets', humanDecision.candidatePatchSetId),
      ])
    if (
      correlatedCandidatePatchSet !== null &&
      correlatedCandidatePatchSet.workflowRunId !== args.workflowRunId
    ) {
      throw new ConvexError(
        'Decision candidate patch set does not belong to workflow',
      )
    }
    // New decisions persist the exact candidate projection they reviewed.
    // The timestamp fallback supports legacy decisions recorded before that link existed.
    const candidatePatchSet =
      correlatedCandidatePatchSet ??
      candidatePatchSets.reduce<
        (typeof candidatePatchSets)[number] | undefined
      >(
        (latest, candidate) =>
          candidate.createdAt <= humanDecision.decidedAt &&
          (latest === undefined || candidate.createdAt > latest.createdAt)
            ? candidate
            : latest,
        undefined,
      )
    const [sandboxExecution, policyDecision] = await Promise.all([
      humanDecision.sandboxExecutionId === undefined
        ? Promise.resolve(null)
        : ctx.db.get('sandboxExecutions', humanDecision.sandboxExecutionId),
      humanDecision.policyDecisionId === undefined
        ? Promise.resolve(null)
        : ctx.db.get('policyDecisions', humanDecision.policyDecisionId),
    ])
    if (
      sandboxExecution !== null &&
      sandboxExecution.workflowRunId !== args.workflowRunId
    ) {
      throw new ConvexError(
        'Decision sandbox execution does not belong to workflow',
      )
    }
    if (
      policyDecision !== null &&
      policyDecision.workflowRunId !== args.workflowRunId
    ) {
      throw new ConvexError('Decision policy does not belong to workflow')
    }
    const requirementPage = await ctx.db
      .query('verificationRequirements')
      .withIndex('by_workflow_run', (q) =>
        q.eq('workflowRunId', args.workflowRunId),
      )
      .take(workflowDetailVerificationRequirementLimit + 1)
    if (requirementPage.length > workflowDetailVerificationRequirementLimit) {
      throw new ConvexError(
        'Verification requirements exceed publication evaluation limit',
      )
    }
    const requiredRequirements = requirementPage.filter(
      (requirement) => requirement.required,
    )
    const policyResults = await Promise.all(
      (policyDecision?.verificationResultIds ?? []).map((resultId) =>
        ctx.db.get('verificationResults', resultId),
      ),
    )
    const passedCount = requiredRequirements.filter((requirement) =>
      policyResults.some(
        (result) =>
          result?.requirementId === requirement._id &&
          result.status === 'passed',
      ),
    ).length
    const reviewRun =
      humanDecision.reviewRunId === undefined
        ? null
        : await ctx.db.get('reviewRuns', humanDecision.reviewRunId)
    if (reviewRun !== null && reviewRun.workflowRunId !== args.workflowRunId) {
      throw new ConvexError('Decision review does not belong to workflow')
    }
    const reviewFindingPage =
      reviewRun === null
        ? []
        : await ctx.db
            .query('reviewFindings')
            .withIndex('by_review_run', (q) =>
              q.eq('reviewRunId', reviewRun._id),
            )
            .order('desc')
            .take(workflowDetailReviewFindingLimit + 1)
    const trustDataTruncated =
      reviewFindingPage.length > workflowDetailReviewFindingLimit
    const reviewFindings = reviewFindingPage.slice(
      0,
      workflowDetailReviewFindingLimit,
    )
    const evidenceArtifactIds = Array.from(
      new Set([
        ...(candidatePatchSet?.diffArtifactId === undefined
          ? []
          : [candidatePatchSet.diffArtifactId]),
        ...policyResults.flatMap((result) => result?.artifactIds ?? []),
      ]),
    )
    const evidenceTruncated =
      evidenceArtifactIds.length > workflowDetailEvidenceArtifactLimit
    const evidenceArtifacts = await Promise.all(
      evidenceArtifactIds
        .slice(0, workflowDetailEvidenceArtifactLimit)
        .map((artifactId) => ctx.db.get('evidenceArtifacts', artifactId)),
    )
    const verificationStatus =
      requiredRequirements.length === 0
        ? ('not-configured' as const)
        : policyResults.some((result) => result?.status === 'failed')
          ? ('failed' as const)
          : passedCount === requiredRequirements.length &&
              (policyDecision?.missingRequirementIds?.length ?? 0) === 0
            ? ('passed' as const)
            : ('incomplete' as const)

    const publications = await Promise.all(
      publicationKeys.map((idempotencyKey) =>
        ctx.db
          .query('publicationResults')
          .withIndex('by_workflow_publication_key', (q) =>
            q
              .eq('workflowRunId', args.workflowRunId)
              .eq('idempotencyKey', idempotencyKey),
          )
          .unique(),
      ),
    )

    if (promptRequest === null) {
      throw new ConvexError('Workflow prompt request not found')
    }
    const rerunRequest = await ctx.db
      .query('workflowRerunRequests')
      .withIndex('by_workflow_run', (q) =>
        q.eq('workflowRunId', workflowRun._id),
      )
      .unique()
    const effectivePrompt =
      rerunRequest === null
        ? promptRequest.prompt
        : `${promptRequest.prompt}\n\nRerun instruction from the reviewer:\n${rerunRequest.reason}`

    return {
      workflowStart: {
        promptRequest: {
          id: promptRequest['_id'],
          workspaceId: promptRequest.workspaceId,
          actorId: promptRequest.actorId,
          traceId: promptRequest.traceId ?? 'legacy',
          source: promptRequest.source,
          // This system-only fixture is consumed through a private service binding.
          // External workflow prompts originate from the same GitHub destination.
          prompt: effectivePrompt,
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
          createdAt: workflowRun.createdAt,
        },
      },
      humanDecision: {
        id: humanDecision['_id'],
        workflowRunId: humanDecision.workflowRunId,
        ...(humanDecision.sandboxExecutionId === undefined
          ? {}
          : { sandboxExecutionId: humanDecision.sandboxExecutionId }),
        ...(humanDecision.candidatePatchSetId === undefined
          ? {}
          : { candidatePatchSetId: humanDecision.candidatePatchSetId }),
        ...(humanDecision.reviewRunId === undefined
          ? {}
          : { reviewRunId: humanDecision.reviewRunId }),
        ...(humanDecision.policyDecisionId === undefined
          ? {}
          : { policyDecisionId: humanDecision.policyDecisionId }),
        actorId: humanDecision.actorId,
        status: humanDecision.status,
        comment: humanDecision.comment,
        ...(humanDecision.verificationOverride === undefined
          ? {}
          : { verificationOverride: humanDecision.verificationOverride }),
        ...(humanDecision.verificationOverrideReason === undefined
          ? {}
          : { verificationOverrideReason: '[redacted override reason]' }),
        decidedAt: humanDecision.decidedAt,
        ...(humanDecision.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: humanDecision.idempotencyKey }),
      },
      ...(sandboxExecution === null
        ? {}
        : {
            sandboxExecution: {
              id: sandboxExecution._id,
              workflowRunId: sandboxExecution.workflowRunId,
              provider: sandboxExecution.provider,
              sandboxId: sandboxExecution.sandboxId,
              command: sandboxExecution.command,
              status: sandboxExecution.status,
              ...(sandboxExecution.exitCode === undefined
                ? {}
                : { exitCode: sandboxExecution.exitCode }),
              stdout: sandboxOutputPreview(sandboxExecution.stdout) ?? '',
              ...(sandboxExecution.stderr === undefined
                ? {}
                : { stderr: sandboxOutputPreview(sandboxExecution.stderr) }),
              ...(sandboxExecution.policy === undefined
                ? {}
                : { policy: sandboxExecution.policy }),
              startedAt: sandboxExecution.startedAt,
              completedAt: sandboxExecution.completedAt,
            },
          }),
      ...(candidatePatchSet === undefined
        ? {}
        : {
            candidatePatchSet: {
              id: candidatePatchSet._id,
              workflowRunId: candidatePatchSet.workflowRunId,
              ...(candidatePatchSet.sandboxExecutionId === undefined
                ? {}
                : { sandboxExecutionId: candidatePatchSet.sandboxExecutionId }),
              ...(candidatePatchSet.subject === undefined
                ? {}
                : { subject: candidatePatchSet.subject }),
              status: candidatePatchSet.status,
              ...(candidatePatchSet.candidateDigest === undefined
                ? {}
                : { candidateDigest: candidatePatchSet.candidateDigest }),
              ...(candidatePatchSet.baseRef === undefined
                ? {}
                : { baseRef: candidatePatchSet.baseRef }),
              ...(candidatePatchSet.baseSha === undefined
                ? {}
                : { baseSha: candidatePatchSet.baseSha }),
              ...(candidatePatchSet.headRef === undefined
                ? {}
                : { headRef: candidatePatchSet.headRef }),
              ...(candidatePatchSet.headSha === undefined
                ? {}
                : { headSha: candidatePatchSet.headSha }),
              ...(candidatePatchSet.diffArtifactId === undefined
                ? {}
                : { diffArtifactId: candidatePatchSet.diffArtifactId }),
              ...(candidatePatchSet.summary === undefined
                ? {}
                : { summary: candidatePatchSet.summary }),
              ...(candidatePatchSet.stats === undefined
                ? {}
                : { stats: candidatePatchSet.stats }),
              ...(candidatePatchSet.idempotencyKey === undefined
                ? {}
                : { idempotencyKey: candidatePatchSet.idempotencyKey }),
              createdAt: candidatePatchSet.createdAt,
            },
          }),
      verificationRequirements: requirementPage.map((requirement) => ({
        id: requirement._id,
        workflowRunId: requirement.workflowRunId,
        key: requirement.key,
        label: requirement.label,
        kind: requirement.kind,
        required: requirement.required,
        ...(requirement.command === undefined
          ? {}
          : { command: requirement.command }),
        ...(requirement.platform === undefined
          ? {}
          : { platform: requirement.platform }),
        ...(requirement.architecture === undefined
          ? {}
          : { architecture: requirement.architecture }),
        requiredArtifactKinds: requirement.requiredArtifactKinds,
        source: requirement.source,
        createdAt: requirement.createdAt,
      })),
      verificationResults: policyResults.flatMap((result) =>
        result === null
          ? []
          : [
              {
                id: result._id,
                workflowRunId: result.workflowRunId,
                ...(result.verificationPlanId === undefined
                  ? {}
                  : { verificationPlanId: result.verificationPlanId }),
                ...(result.executionGroupId === undefined
                  ? {}
                  : { executionGroupId: result.executionGroupId }),
                requirementId: result.requirementId,
                candidatePatchSetId: result.candidatePatchSetId,
                ...(result.sandboxExecutionId === undefined
                  ? {}
                  : { sandboxExecutionId: result.sandboxExecutionId }),
                provider: result.provider,
                ...(result.command === undefined
                  ? {}
                  : { command: result.command }),
                ...(result.commandDigest === undefined
                  ? {}
                  : { commandDigest: result.commandDigest }),
                platform: result.platform,
                architecture: result.architecture,
                ...(result.environmentImage === undefined
                  ? {}
                  : { environmentImage: result.environmentImage }),
                status: result.status,
                ...(result.exitCode === undefined
                  ? {}
                  : { exitCode: result.exitCode }),
                ...(result.summary === undefined
                  ? {}
                  : { summary: result.summary }),
                ...(result.passedCount === undefined
                  ? {}
                  : { passedCount: result.passedCount }),
                ...(result.failedCount === undefined
                  ? {}
                  : { failedCount: result.failedCount }),
                ...(result.skippedCount === undefined
                  ? {}
                  : { skippedCount: result.skippedCount }),
                artifactIds: result.artifactIds,
                producedArtifactKinds: result.producedArtifactKinds,
                ...(result.stdoutArtifactId === undefined
                  ? {}
                  : { stdoutArtifactId: result.stdoutArtifactId }),
                ...(result.stderrArtifactId === undefined
                  ? {}
                  : { stderrArtifactId: result.stderrArtifactId }),
                ...(result.stdoutCaptureStatus === undefined
                  ? {}
                  : { stdoutCaptureStatus: result.stdoutCaptureStatus }),
                ...(result.stderrCaptureStatus === undefined
                  ? {}
                  : { stderrCaptureStatus: result.stderrCaptureStatus }),
                ...(result.cleanupStatus === undefined
                  ? {}
                  : { cleanupStatus: result.cleanupStatus }),
                ...(result.candidateDigestBefore === undefined
                  ? {}
                  : { candidateDigestBefore: result.candidateDigestBefore }),
                ...(result.candidateDigestAfter === undefined
                  ? {}
                  : { candidateDigestAfter: result.candidateDigestAfter }),
                startedAt: result.startedAt,
                ...(result.completedAt === undefined
                  ? {}
                  : { completedAt: result.completedAt }),
                idempotencyKey: result.idempotencyKey,
              },
            ],
      ),
      ...(reviewRun === null
        ? {}
        : {
            reviewRun: {
              id: reviewRun._id,
              workflowRunId: reviewRun.workflowRunId,
              ...(reviewRun.sandboxExecutionId === undefined
                ? {}
                : { sandboxExecutionId: reviewRun.sandboxExecutionId }),
              ...(reviewRun.candidatePatchSetId === undefined
                ? {}
                : { candidatePatchSetId: reviewRun.candidatePatchSetId }),
              kind: reviewRun.kind,
              reviewer: reviewRun.reviewer,
              status: reviewRun.status,
              ...(reviewRun.summary === undefined
                ? {}
                : { summary: reviewRun.summary }),
              startedAt: reviewRun.startedAt,
              ...(reviewRun.completedAt === undefined
                ? {}
                : { completedAt: reviewRun.completedAt }),
              ...(reviewRun.idempotencyKey === undefined
                ? {}
                : { idempotencyKey: reviewRun.idempotencyKey }),
              createdAt: reviewRun.createdAt,
            },
          }),
      reviewFindings: reviewFindings.map((finding) => ({
        id: finding._id,
        workflowRunId: finding.workflowRunId,
        ...(finding.reviewRunId === undefined
          ? {}
          : { reviewRunId: finding.reviewRunId }),
        severity: finding.severity,
        category: finding.category,
        message: finding.message,
        ...(finding.path === undefined ? {} : { path: finding.path }),
        ...(finding.startLine === undefined
          ? {}
          : { startLine: finding.startLine }),
        ...(finding.endLine === undefined ? {} : { endLine: finding.endLine }),
        ...(finding.evidenceArtifactId === undefined
          ? {}
          : { evidenceArtifactId: finding.evidenceArtifactId }),
        ...(finding.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: finding.idempotencyKey }),
        createdAt: finding.createdAt,
      })),
      ...(policyDecision === null
        ? {}
        : {
            policyDecision: {
              id: policyDecision._id,
              workflowRunId: policyDecision.workflowRunId,
              ...(policyDecision.reviewRunId === undefined
                ? {}
                : { reviewRunId: policyDecision.reviewRunId }),
              ...(policyDecision.candidatePatchSetId === undefined
                ? {}
                : { candidatePatchSetId: policyDecision.candidatePatchSetId }),
              status: policyDecision.status,
              summary: policyDecision.summary,
              ...(policyDecision.reason === undefined
                ? {}
                : { reason: policyDecision.reason }),
              ...(policyDecision.policyVersion === undefined
                ? {}
                : { policyVersion: policyDecision.policyVersion }),
              ...(policyDecision.inputDigest === undefined
                ? {}
                : { inputDigest: policyDecision.inputDigest }),
              ...(policyDecision.verificationResultIds === undefined
                ? {}
                : {
                    verificationResultIds: policyDecision.verificationResultIds,
                  }),
              ...(policyDecision.reviewFindingIds === undefined
                ? {}
                : { reviewFindingIds: policyDecision.reviewFindingIds }),
              ...(policyDecision.missingRequirementIds === undefined
                ? {}
                : {
                    missingRequirementIds: policyDecision.missingRequirementIds,
                  }),
              ...(policyDecision.idempotencyKey === undefined
                ? {}
                : { idempotencyKey: policyDecision.idempotencyKey }),
              createdAt: policyDecision.createdAt,
            },
          }),
      evidenceArtifacts: evidenceArtifacts.flatMap((artifact) =>
        artifact === null
          ? []
          : [
              {
                id: artifact._id,
                workflowRunId: artifact.workflowRunId,
                ...(artifact.producer === undefined
                  ? {}
                  : { producer: artifact.producer }),
                ...(artifact.subjectDigest === undefined
                  ? {}
                  : { subjectDigest: artifact.subjectDigest }),
                ...(artifact.traceId === undefined
                  ? {}
                  : { traceId: artifact.traceId }),
                kind: artifact.kind,
                ...(artifact.label === undefined
                  ? {}
                  : { label: artifact.label }),
                storageProvider: artifact.storageProvider,
                storageKey: artifact.storageKey,
                contentType: artifact.contentType,
                sizeBytes: artifact.sizeBytes,
                sha256: artifact.sha256,
                ...(artifact.retentionPolicy === undefined
                  ? {}
                  : { retentionPolicy: artifact.retentionPolicy }),
                createdAt: artifact.createdAt,
              },
            ],
      ),
      trustDataTruncated,
      evidenceTruncated,
      verification: {
        status: verificationStatus,
        requiredCount: requiredRequirements.length,
        passedCount,
      },
      ...(candidatePatchSet?.headSha === undefined
        ? {}
        : { candidateHeadSha: candidatePatchSet.headSha }),
      publicationResults: publications.flatMap((publication) =>
        publication === null
          ? []
          : [
              {
                id: publication['_id'],
                workflowRunId: publication.workflowRunId,
                ...(publication.humanDecisionId === undefined
                  ? {}
                  : { humanDecisionId: publication.humanDecisionId }),
                ...(publication.candidatePatchSetId === undefined
                  ? {}
                  : { candidatePatchSetId: publication.candidatePatchSetId }),
                ...(publication.targetSha === undefined
                  ? {}
                  : { targetSha: publication.targetSha }),
                provider: publication.provider,
                kind: publication.kind,
                status: publication.status,
                ...(publication.externalId === undefined
                  ? {}
                  : { externalId: publication.externalId }),
                ...(publication.url === undefined
                  ? {}
                  : { url: publication.url }),
                ...(publication.summary === undefined
                  ? {}
                  : { summary: publication.summary }),
                ...(publication.error === undefined
                  ? {}
                  : { error: publication.error }),
                ...(publication.dispatchToken === undefined
                  ? {}
                  : { dispatchToken: publication.dispatchToken }),
                createdAt: publication.createdAt,
                ...(publication.idempotencyKey === undefined
                  ? {}
                  : { idempotencyKey: publication.idempotencyKey }),
              },
            ],
      ),
    }
  },
})

export const publicationFixtureFunctions = {
  getDecisionPublicationReplayFixture,
}
