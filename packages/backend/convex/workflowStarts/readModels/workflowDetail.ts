import { ConvexError, v } from 'convex/values'
import { query } from '../../_generated/server'
import {
  workflowDetailRuntimeEventLimit,
  workflowDetailSandboxExecutionLimit,
  workflowDetailVerificationRequirementLimit,
  workflowDetailVerificationResultLimit,
  workflowDetailRuntimeSessionLimit,
  workflowDetailEvidenceArtifactLimit,
  workflowDetailCandidatePatchSetLimit,
  workflowDetailReviewRunLimit,
  workflowDetailReviewFindingLimit,
  workflowDetailPolicyDecisionLimit,
  workflowDetailHumanDecisionLimit,
  workflowDetailPublicationResultLimit,
  workflowDetailProvenanceEventLimit,
  runtimePayloadPreview,
  sandboxOutputPreview,
  sandboxCommandPreview,
  sandboxRuntimeModel,
  requireWorkOSWorkspace,
  requireWorkOSIdentity,
  requireMembershipPermission,
  sortedByNumber,
  workflowDetailReturn,
} from '../shared'

const getDetail = query({
  args: {
    workflowRunId: v.string(),
  },
  returns: workflowDetailReturn,
  handler: async (ctx, args) => {
    const identity = await requireWorkOSIdentity(ctx)
    const workflowRunId = ctx.db.normalizeId('workflowRuns', args.workflowRunId)
    if (workflowRunId === null) {
      throw new ConvexError('Workflow run not found')
    }
    const workflowRun = await ctx.db.get('workflowRuns', workflowRunId)

    if (workflowRun === null) {
      throw new ConvexError('Workflow run not found')
    }

    requireWorkOSWorkspace(identity, workflowRun.workspaceId)
    await requireMembershipPermission(
      ctx,
      identity,
      workflowRun.workspaceId,
      'workspace:view',
    )

    const promptRequest = await ctx.db.get(
      'promptRequests',
      workflowRun.promptRequestId,
    )
    if (promptRequest === null) {
      throw new ConvexError('Workflow prompt request not found')
    }

    const rootWorkflowRunId = workflowRun.rootWorkflowRunId ?? workflowRun._id
    const latestAttempt =
      workflowRun.modelVersion === 'v1'
        ? await ctx.db
            .query('workflowRuns')
            .withIndex('by_root_attempt', (q) =>
              q.eq('rootWorkflowRunId', rootWorkflowRunId),
            )
            .order('desc')
            .first()
        : null
    const newerAttempt =
      latestAttempt !== null &&
      latestAttempt._id !== workflowRun._id &&
      (latestAttempt.attemptNumber ?? 1) > (workflowRun.attemptNumber ?? 1)
        ? latestAttempt
        : undefined

    const runtimeEventPage = await ctx.db
      .query('runtimeEvents')
      .withIndex('by_workflow_run', (q) => q.eq('workflowRunId', workflowRunId))
      .order('desc')
      .take(workflowDetailRuntimeEventLimit + 1)
    const runtimeEventsTruncated =
      runtimeEventPage.length > workflowDetailRuntimeEventLimit
    const runtimeEvents = runtimeEventPage.slice(
      0,
      workflowDetailRuntimeEventLimit,
    )

    const runtimeSessionPage = await ctx.db
      .query('runtimeSessions')
      .withIndex('by_workflow_run', (q) => q.eq('workflowRunId', workflowRunId))
      .order('desc')
      .take(workflowDetailRuntimeSessionLimit + 1)
    const runtimeSessionsTruncated =
      runtimeSessionPage.length > workflowDetailRuntimeSessionLimit
    const runtimeSessions = runtimeSessionPage.slice(
      0,
      workflowDetailRuntimeSessionLimit,
    )

    const sandboxExecutions = await ctx.db
      .query('sandboxExecutions')
      .withIndex('by_workflow_run', (q) => q.eq('workflowRunId', workflowRunId))
      .order('desc')
      .take(workflowDetailSandboxExecutionLimit + 1)
    const sandboxExecutionsTruncated =
      sandboxExecutions.length > workflowDetailSandboxExecutionLimit
    const boundedSandboxExecutions = sandboxExecutions.slice(
      0,
      workflowDetailSandboxExecutionLimit,
    )

    const evidenceArtifactPage = await ctx.db
      .query('evidenceArtifacts')
      .withIndex('by_workflow_run', (q) => q.eq('workflowRunId', workflowRunId))
      .order('desc')
      .take(workflowDetailEvidenceArtifactLimit + 1)
    const evidenceArtifactsTruncated =
      evidenceArtifactPage.length > workflowDetailEvidenceArtifactLimit
    const evidenceArtifacts = evidenceArtifactPage.slice(
      0,
      workflowDetailEvidenceArtifactLimit,
    )

    const candidatePatchSetPage = await ctx.db
      .query('candidatePatchSets')
      .withIndex('by_workflow_run', (q) => q.eq('workflowRunId', workflowRunId))
      .order('desc')
      .take(workflowDetailCandidatePatchSetLimit + 1)
    const candidatePatchSetsTruncated =
      candidatePatchSetPage.length > workflowDetailCandidatePatchSetLimit
    const candidatePatchSets = candidatePatchSetPage.slice(
      0,
      workflowDetailCandidatePatchSetLimit,
    )

    const verificationRequirementPage = await ctx.db
      .query('verificationRequirements')
      .withIndex('by_workflow_run', (q) => q.eq('workflowRunId', workflowRunId))
      .order('desc')
      .take(workflowDetailVerificationRequirementLimit + 1)
    const verificationRequirementsTruncated =
      verificationRequirementPage.length >
      workflowDetailVerificationRequirementLimit
    const verificationRequirements = verificationRequirementPage.slice(
      0,
      workflowDetailVerificationRequirementLimit,
    )

    const verificationResultPage = await ctx.db
      .query('verificationResults')
      .withIndex('by_workflow_run', (q) => q.eq('workflowRunId', workflowRunId))
      .order('desc')
      .take(workflowDetailVerificationResultLimit + 1)
    const verificationResultsTruncated =
      verificationResultPage.length > workflowDetailVerificationResultLimit
    const verificationResults = verificationResultPage.slice(
      0,
      workflowDetailVerificationResultLimit,
    )

    const reviewRunPage = await ctx.db
      .query('reviewRuns')
      .withIndex('by_workflow_run', (q) => q.eq('workflowRunId', workflowRunId))
      .order('desc')
      .take(workflowDetailReviewRunLimit + 1)
    const reviewRunsTruncated =
      reviewRunPage.length > workflowDetailReviewRunLimit
    const reviewRuns = reviewRunPage.slice(0, workflowDetailReviewRunLimit)

    const reviewFindingPage = await ctx.db
      .query('reviewFindings')
      .withIndex('by_workflow_run', (q) => q.eq('workflowRunId', workflowRunId))
      .order('desc')
      .take(workflowDetailReviewFindingLimit + 1)
    const reviewFindingsTruncated =
      reviewFindingPage.length > workflowDetailReviewFindingLimit
    const reviewFindings = reviewFindingPage.slice(
      0,
      workflowDetailReviewFindingLimit,
    )

    const policyDecisionPage = await ctx.db
      .query('policyDecisions')
      .withIndex('by_workflow_run', (q) => q.eq('workflowRunId', workflowRunId))
      .order('desc')
      .take(workflowDetailPolicyDecisionLimit + 1)
    const policyDecisionsTruncated =
      policyDecisionPage.length > workflowDetailPolicyDecisionLimit
    const policyDecisions = policyDecisionPage.slice(
      0,
      workflowDetailPolicyDecisionLimit,
    )

    const humanDecisionPage = await ctx.db
      .query('humanDecisions')
      .withIndex('by_workflow_run', (q) => q.eq('workflowRunId', workflowRunId))
      .order('desc')
      .take(workflowDetailHumanDecisionLimit + 1)
    const humanDecisionsTruncated =
      humanDecisionPage.length > workflowDetailHumanDecisionLimit
    const humanDecisions = humanDecisionPage.slice(
      0,
      workflowDetailHumanDecisionLimit,
    )

    const publicationResultPage = await ctx.db
      .query('publicationResults')
      .withIndex('by_workflow_run', (q) => q.eq('workflowRunId', workflowRunId))
      .order('desc')
      .take(workflowDetailPublicationResultLimit + 1)
    const publicationResultsTruncated =
      publicationResultPage.length > workflowDetailPublicationResultLimit
    const publicationResults = publicationResultPage.slice(
      0,
      workflowDetailPublicationResultLimit,
    )

    const provenanceEventPage = await ctx.db
      .query('provenanceEvents')
      .withIndex('by_workflow_run', (q) => q.eq('workflowRunId', workflowRunId))
      .order('desc')
      .take(workflowDetailProvenanceEventLimit + 1)
    const provenanceEventsTruncated =
      provenanceEventPage.length > workflowDetailProvenanceEventLimit
    const provenanceEvents = provenanceEventPage.slice(
      0,
      workflowDetailProvenanceEventLimit,
    )

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
      ...(newerAttempt === undefined
        ? {}
        : {
            newerAttempt: {
              workflowRunId: newerAttempt._id,
              attemptNumber: newerAttempt.attemptNumber ?? 1,
              status: newerAttempt.status,
              createdAt: newerAttempt.createdAt,
            },
          }),
      runtimeEvents: sortedByNumber(
        runtimeEvents,
        (event) => event.occurredAt,
      ).map((event) => {
        const payloadJson = runtimePayloadPreview(event.payloadJson)
        return {
          id: event['_id'],
          workflowRunId: event.workflowRunId,
          provider: event.provider,
          type: event.type,
          occurredAt: event.occurredAt,
          ...(event.summary === undefined ? {} : { summary: event.summary }),
          ...(payloadJson === undefined ? {} : { payloadJson }),
          ...(event.idempotencyKey === undefined
            ? {}
            : { idempotencyKey: event.idempotencyKey }),
          ...(event.sourceSessionId === undefined
            ? {}
            : { sourceSessionId: event.sourceSessionId }),
          ...(event.sourceCommandId === undefined
            ? {}
            : { sourceCommandId: event.sourceCommandId }),
          ...(event.sourceStream === undefined
            ? {}
            : { sourceStream: event.sourceStream }),
          ...(event.sourceLine === undefined
            ? {}
            : { sourceLine: event.sourceLine }),
          ...(event.sourceOffset === undefined
            ? {}
            : { sourceOffset: event.sourceOffset }),
        }
      }),
      runtimeEventsTruncated,
      runtimeSessions: sortedByNumber(
        runtimeSessions,
        (session) => session.startedAt,
      ).map((session) => ({
        id: session['_id'],
        workflowRunId: session.workflowRunId,
        provider: session.provider,
        sandboxId: session.sandboxId,
        sessionId: session.sessionId,
        commandId: session.commandId,
        status: session.status,
        startedAt: session.startedAt,
        updatedAt: session.updatedAt,
        ...(session.completedAt === undefined
          ? {}
          : { completedAt: session.completedAt }),
      })),
      runtimeSessionsTruncated,
      sandboxExecutions: sortedByNumber(
        boundedSandboxExecutions,
        (execution) => execution.startedAt,
      ).map((execution) => ({
        id: execution['_id'],
        workflowRunId: execution.workflowRunId,
        ...(execution.executionGroupId === undefined
          ? {}
          : { executionGroupId: execution.executionGroupId }),
        provider: execution.provider,
        sandboxId: execution.sandboxId,
        command: sandboxCommandPreview(execution.command),
        ...(sandboxRuntimeModel(execution.command) === undefined
          ? {}
          : { runtimeModel: sandboxRuntimeModel(execution.command) }),
        status: execution.status,
        ...(execution.exitCode === undefined
          ? {}
          : { exitCode: execution.exitCode }),
        stdout: sandboxOutputPreview(execution.stdout) ?? '',
        ...(execution.stderr === undefined
          ? {}
          : { stderr: sandboxOutputPreview(execution.stderr) }),
        ...(execution.policy === undefined ? {} : { policy: execution.policy }),
        startedAt: execution.startedAt,
        completedAt: execution.completedAt,
      })),
      sandboxExecutionsTruncated,
      evidenceArtifacts: sortedByNumber(
        evidenceArtifacts,
        (artifact) => artifact.createdAt,
      ).map((artifact) => ({
        id: artifact['_id'],
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
        ...(artifact.label === undefined ? {} : { label: artifact.label }),
        storageProvider: artifact.storageProvider,
        storageKey: artifact.storageKey,
        contentType: artifact.contentType,
        sizeBytes: artifact.sizeBytes,
        sha256: artifact.sha256,
        ...(artifact.retentionPolicy === undefined
          ? {}
          : { retentionPolicy: artifact.retentionPolicy }),
        createdAt: artifact.createdAt,
      })),
      evidenceArtifactsTruncated,
      candidatePatchSets: sortedByNumber(
        candidatePatchSets,
        (patchSet) => patchSet.createdAt,
      ).map((patchSet) => ({
        id: patchSet['_id'],
        workflowRunId: patchSet.workflowRunId,
        ...(patchSet.sandboxExecutionId === undefined
          ? {}
          : { sandboxExecutionId: patchSet.sandboxExecutionId }),
        ...(patchSet.subject === undefined
          ? {}
          : { subject: patchSet.subject }),
        status: patchSet.status,
        ...(patchSet.candidateDigest === undefined
          ? {}
          : { candidateDigest: patchSet.candidateDigest }),
        ...(patchSet.baseRef === undefined
          ? {}
          : { baseRef: patchSet.baseRef }),
        ...(patchSet.baseSha === undefined
          ? {}
          : { baseSha: patchSet.baseSha }),
        ...(patchSet.headRef === undefined
          ? {}
          : { headRef: patchSet.headRef }),
        ...(patchSet.headSha === undefined
          ? {}
          : { headSha: patchSet.headSha }),
        ...(patchSet.diffArtifactId === undefined
          ? {}
          : { diffArtifactId: patchSet.diffArtifactId }),
        ...(patchSet.summary === undefined
          ? {}
          : { summary: patchSet.summary }),
        ...(patchSet.stats === undefined ? {} : { stats: patchSet.stats }),
        ...(patchSet.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: patchSet.idempotencyKey }),
        createdAt: patchSet.createdAt,
      })),
      candidatePatchSetsTruncated,
      verificationRequirements: sortedByNumber(
        verificationRequirements,
        (requirement) => requirement.createdAt,
      ).map((requirement) => ({
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
      verificationRequirementsTruncated,
      verificationResults: sortedByNumber(
        verificationResults,
        (result) => result.startedAt,
      ).map((result) => ({
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
        ...(result.command === undefined ? {} : { command: result.command }),
        ...(result.commandDigest === undefined
          ? {}
          : { commandDigest: result.commandDigest }),
        platform: result.platform,
        architecture: result.architecture,
        ...(result.environmentImage === undefined
          ? {}
          : { environmentImage: result.environmentImage }),
        status: result.status,
        ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
        ...(result.summary === undefined ? {} : { summary: result.summary }),
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
      })),
      verificationResultsTruncated,
      reviewRuns: sortedByNumber(
        reviewRuns,
        (reviewRun) => reviewRun.startedAt,
      ).map((reviewRun) => ({
        id: reviewRun['_id'],
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
      })),
      reviewRunsTruncated,
      reviewFindings: sortedByNumber(
        reviewFindings,
        (finding) => finding.createdAt,
      ).map((finding) => ({
        id: finding['_id'],
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
      reviewFindingsTruncated,
      policyDecisions: sortedByNumber(
        policyDecisions,
        (decision) => decision.createdAt,
      ).map((decision) => ({
        id: decision['_id'],
        workflowRunId: decision.workflowRunId,
        ...(decision.reviewRunId === undefined
          ? {}
          : { reviewRunId: decision.reviewRunId }),
        ...(decision.candidatePatchSetId === undefined
          ? {}
          : { candidatePatchSetId: decision.candidatePatchSetId }),
        status: decision.status,
        summary: decision.summary,
        ...(decision.reason === undefined ? {} : { reason: decision.reason }),
        ...(decision.policyVersion === undefined
          ? {}
          : { policyVersion: decision.policyVersion }),
        ...(decision.inputDigest === undefined
          ? {}
          : { inputDigest: decision.inputDigest }),
        ...(decision.verificationResultIds === undefined
          ? {}
          : { verificationResultIds: decision.verificationResultIds }),
        ...(decision.reviewFindingIds === undefined
          ? {}
          : { reviewFindingIds: decision.reviewFindingIds }),
        ...(decision.missingRequirementIds === undefined
          ? {}
          : { missingRequirementIds: decision.missingRequirementIds }),
        ...(decision.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: decision.idempotencyKey }),
        createdAt: decision.createdAt,
      })),
      policyDecisionsTruncated,
      humanDecisions: sortedByNumber(
        humanDecisions,
        (decision) => decision.decidedAt,
      ).map((decision) => ({
        id: decision['_id'],
        workflowRunId: decision.workflowRunId,
        ...(decision.sandboxExecutionId === undefined
          ? {}
          : { sandboxExecutionId: decision.sandboxExecutionId }),
        ...(decision.candidatePatchSetId === undefined
          ? {}
          : { candidatePatchSetId: decision.candidatePatchSetId }),
        ...(decision.reviewRunId === undefined
          ? {}
          : { reviewRunId: decision.reviewRunId }),
        ...(decision.policyDecisionId === undefined
          ? {}
          : { policyDecisionId: decision.policyDecisionId }),
        actorId: decision.actorId,
        status: decision.status,
        comment: decision.comment,
        ...(decision.verificationOverride === undefined
          ? {}
          : { verificationOverride: decision.verificationOverride }),
        ...(decision.verificationOverrideReason === undefined
          ? {}
          : {
              verificationOverrideReason: decision.verificationOverrideReason,
            }),
        decidedAt: decision.decidedAt,
        ...(decision.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: decision.idempotencyKey }),
      })),
      humanDecisionsTruncated,
      publicationResults: sortedByNumber(
        publicationResults,
        (result) => result.createdAt,
      ).map((result) => ({
        id: result['_id'],
        workflowRunId: result.workflowRunId,
        ...(result.humanDecisionId === undefined
          ? {}
          : { humanDecisionId: result.humanDecisionId }),
        ...(result.candidatePatchSetId === undefined
          ? {}
          : { candidatePatchSetId: result.candidatePatchSetId }),
        ...(result.targetSha === undefined
          ? {}
          : { targetSha: result.targetSha }),
        provider: result.provider,
        kind: result.kind,
        status: result.status,
        ...(result.externalId === undefined
          ? {}
          : { externalId: result.externalId }),
        ...(result.url === undefined ? {} : { url: result.url }),
        ...(result.summary === undefined ? {} : { summary: result.summary }),
        ...(result.error === undefined ? {} : { error: result.error }),
        ...(result.dispatchToken === undefined
          ? {}
          : { dispatchToken: result.dispatchToken }),
        createdAt: result.createdAt,
        ...(result.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: result.idempotencyKey }),
      })),
      publicationResultsTruncated,
      provenanceEvents: sortedByNumber(
        provenanceEvents,
        (event) => event.sequence,
      ).map((event) => ({
        id: event['_id'],
        workflowRunId: event.workflowRunId,
        traceId: event.traceId,
        ...(event.parentEventId === undefined
          ? {}
          : { parentEventId: event.parentEventId }),
        sequence: event.sequence,
        type: event.type,
        operation: event.operation,
        ...(event.pluginName === undefined
          ? {}
          : { pluginName: event.pluginName }),
        status: event.status,
        startedAt: event.startedAt,
        ...(event.completedAt === undefined
          ? {}
          : { completedAt: event.completedAt }),
        ...(event.summary === undefined ? {} : { summary: event.summary }),
        artifactRefs: event.artifactRefs,
        ...(event.errorCategory === undefined
          ? {}
          : { errorCategory: event.errorCategory }),
        ...(event.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: event.idempotencyKey }),
      })),
      provenanceEventsTruncated,
    }
  },
})

export const workflowDetailFunctions = {
  getDetail,
}
