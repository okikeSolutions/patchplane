import { ConvexError, v } from 'convex/values'
import { mutation } from '../../_generated/server'
import {
  isEpochMillis,
  isValidProviderProcessIdentityPair,
  verificationPlatformArg,
  verificationLogCaptureStatusArg,
  sandboxCleanupStatusArg,
  verificationResultStatusArg,
  verificationResultReturn,
  requireSystemIngestionSecret,
  requireWorkflowRun,
  sha256Digest,
} from '../shared'

const recordVerificationResult = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    verificationPlanId: v.optional(v.id('verificationPlans')),
    executionGroupId: v.optional(v.id('verificationExecutionGroups')),
    executionGroupClaimToken: v.optional(v.string()),
    requirementId: v.id('verificationRequirements'),
    candidatePatchSetId: v.id('candidatePatchSets'),
    sandboxExecutionId: v.optional(v.id('sandboxExecutions')),
    provider: v.string(),
    command: v.optional(v.string()),
    commandDigest: v.optional(v.string()),
    platform: verificationPlatformArg,
    architecture: v.string(),
    environmentImage: v.optional(v.string()),
    providerSessionId: v.optional(v.string()),
    providerCommandId: v.optional(v.string()),
    status: verificationResultStatusArg,
    exitCode: v.optional(v.number()),
    summary: v.optional(v.string()),
    passedCount: v.optional(v.number()),
    failedCount: v.optional(v.number()),
    skippedCount: v.optional(v.number()),
    artifactIds: v.array(v.id('evidenceArtifacts')),
    stdoutArtifactId: v.optional(v.id('evidenceArtifacts')),
    stderrArtifactId: v.optional(v.id('evidenceArtifacts')),
    stdoutCaptureStatus: v.optional(verificationLogCaptureStatusArg),
    stderrCaptureStatus: v.optional(verificationLogCaptureStatusArg),
    cleanupStatus: v.optional(sandboxCleanupStatusArg),
    candidateDigestBefore: v.optional(v.string()),
    candidateDigestAfter: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    idempotencyKey: v.string(),
  },
  returns: verificationResultReturn,
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    await requireWorkflowRun(ctx, args.workflowRunId)
    if (args.artifactIds.length > 16) {
      throw new ConvexError('Verification result artifacts exceed limit')
    }
    if (
      !isValidProviderProcessIdentityPair(
        args.providerSessionId,
        args.providerCommandId,
      )
    ) {
      throw new ConvexError('Verification provider process identity is invalid')
    }
    if (
      !isEpochMillis(args.startedAt) ||
      (args.completedAt !== undefined &&
        (!isEpochMillis(args.completedAt) ||
          args.completedAt < args.startedAt ||
          args.completedAt > Date.now() + 60_000))
    ) {
      throw new ConvexError('Verification completion cannot predate its start')
    }

    const [requirement, candidate, sandboxExecution, loadedExecutionGroup] =
      await Promise.all([
        ctx.db.get('verificationRequirements', args.requirementId),
        ctx.db.get('candidatePatchSets', args.candidatePatchSetId),
        args.sandboxExecutionId === undefined
          ? Promise.resolve(null)
          : ctx.db.get('sandboxExecutions', args.sandboxExecutionId),
        args.executionGroupId === undefined
          ? Promise.resolve(null)
          : ctx.db.get('verificationExecutionGroups', args.executionGroupId),
      ])
    let executionGroup = loadedExecutionGroup
    if (
      executionGroup !== null &&
      executionGroup.workflowRunId === args.workflowRunId &&
      executionGroup.claimToken === args.executionGroupClaimToken &&
      executionGroup.status === 'running' &&
      executionGroup.providerSessionId === undefined &&
      executionGroup.providerCommandId === undefined &&
      args.providerSessionId !== undefined &&
      args.providerCommandId !== undefined &&
      args.status !== 'passed'
    ) {
      await ctx.db.patch('verificationExecutionGroups', executionGroup._id, {
        providerSessionId: args.providerSessionId,
        providerCommandId: args.providerCommandId,
      })
      executionGroup = {
        ...executionGroup,
        providerSessionId: args.providerSessionId,
        providerCommandId: args.providerCommandId,
      }
    }
    const artifacts = await Promise.all(
      args.artifactIds.map((artifactId) =>
        ctx.db.get('evidenceArtifacts', artifactId),
      ),
    )
    const stdoutArtifact =
      args.stdoutArtifactId === undefined
        ? null
        : await ctx.db.get('evidenceArtifacts', args.stdoutArtifactId)
    const stderrArtifact =
      args.stderrArtifactId === undefined
        ? null
        : await ctx.db.get('evidenceArtifacts', args.stderrArtifactId)
    if (
      requirement === null ||
      requirement.workflowRunId !== args.workflowRunId
    ) {
      throw new ConvexError(
        'Verification requirement does not belong to workflow',
      )
    }
    if (candidate === null || candidate.workflowRunId !== args.workflowRunId) {
      throw new ConvexError('Candidate patch set does not belong to workflow')
    }
    if (
      args.sandboxExecutionId !== undefined &&
      (sandboxExecution === null ||
        sandboxExecution.workflowRunId !== args.workflowRunId)
    ) {
      throw new ConvexError('Sandbox execution does not belong to workflow')
    }
    if (
      artifacts.some(
        (artifact) =>
          artifact === null || artifact.workflowRunId !== args.workflowRunId,
      )
    ) {
      throw new ConvexError('Verification artifact does not belong to workflow')
    }
    const computedCommandDigest =
      args.command === undefined ? undefined : await sha256Digest(args.command)
    const existing = await ctx.db
      .query('verificationResults')
      .withIndex('by_workflow_run_and_idempotency_key', (q) =>
        q
          .eq('workflowRunId', args.workflowRunId)
          .eq('idempotencyKey', args.idempotencyKey),
      )
      .unique()
    if (
      args.executionGroupId !== undefined &&
      (executionGroup === null ||
        executionGroup.workflowRunId !== args.workflowRunId ||
        executionGroup.verificationPlanId !== args.verificationPlanId ||
        executionGroup.requirementId !== args.requirementId ||
        executionGroup.candidatePatchSetId !== args.candidatePatchSetId ||
        executionGroup.claimToken !== args.executionGroupClaimToken ||
        executionGroup.provider !== args.provider ||
        executionGroup.platform !== args.platform ||
        executionGroup.architecture !== args.architecture ||
        executionGroup.providerSessionId !== args.providerSessionId ||
        executionGroup.providerCommandId !== args.providerCommandId ||
        executionGroup.commandDigest !== args.commandDigest ||
        args.commandDigest !== computedCommandDigest ||
        requirement.command !== args.command ||
        (executionGroup.status !== 'claimed' &&
          executionGroup.status !== 'running' &&
          existing?.executionGroupId !== executionGroup._id) ||
        executionGroup.sandboxExecutionId !== args.sandboxExecutionId)
    ) {
      throw new ConvexError(
        'Verification execution group does not match result',
      )
    }
    const producedArtifactKinds = Array.from(
      new Set(
        artifacts.flatMap((artifact) =>
          artifact === null ? [] : [artifact.kind],
        ),
      ),
    )
    const expectedProducer =
      sandboxExecution === null
        ? undefined
        : `sandbox:${requirement.kind}:${sandboxExecution.provider}:${sandboxExecution.sandboxId}:${sandboxExecution.startedAt}`
    const artifactsBoundToCandidate = artifacts.every(
      (artifact) =>
        artifact !== null &&
        artifact.producer === expectedProducer &&
        artifact.subjectDigest === candidate.candidateDigest,
    )
    const requirementMatchesInvocation =
      (requirement.command === undefined ||
        requirement.command === args.command) &&
      (requirement.platform === undefined ||
        requirement.platform === args.platform) &&
      (requirement.architecture === undefined ||
        requirement.architecture === args.architecture)
    const trustedIncomingExecutionGroup =
      candidate.subject?.kind === 'incoming-pull-request' &&
      executionGroup !== null &&
      args.verificationPlanId !== undefined &&
      requirement.verificationPlanId === args.verificationPlanId &&
      executionGroup.sharedState === false &&
      executionGroup.provider === args.provider &&
      executionGroup.platform === args.platform &&
      executionGroup.architecture === args.architecture
    const trustedGroup = trustedIncomingExecutionGroup ? executionGroup : null
    if (
      args.status === 'passed' &&
      candidate.subject?.kind === 'incoming-pull-request' &&
      !trustedIncomingExecutionGroup
    ) {
      throw new ConvexError(
        'Passed incoming PR verification requires a trusted execution group',
      )
    }
    if (
      args.status === 'passed' &&
      (candidate.status !== 'captured' ||
        candidate.candidateDigest === undefined ||
        args.sandboxExecutionId === undefined ||
        (candidate.subject?.kind !== 'incoming-pull-request' &&
          candidate.sandboxExecutionId !== args.sandboxExecutionId) ||
        sandboxExecution === null ||
        sandboxExecution.status !== 'succeeded' ||
        sandboxExecution.exitCode !== 0 ||
        args.completedAt === undefined ||
        args.exitCode !== 0 ||
        args.candidateDigestBefore !== candidate.candidateDigest ||
        args.candidateDigestAfter !== candidate.candidateDigest ||
        !requirementMatchesInvocation ||
        !artifactsBoundToCandidate ||
        (trustedGroup !== null &&
          (sandboxExecution.provider !== args.provider ||
            sandboxExecution.command !== args.command ||
            args.startedAt < sandboxExecution.startedAt ||
            args.completedAt > sandboxExecution.completedAt ||
            args.commandDigest === undefined ||
            args.commandDigest !== computedCommandDigest ||
            trustedGroup.commandDigest !== args.commandDigest ||
            trustedGroup.providerSessionId === undefined ||
            trustedGroup.providerSessionId !== args.providerSessionId ||
            trustedGroup.providerCommandId === undefined ||
            trustedGroup.providerCommandId !== args.providerCommandId ||
            sandboxExecution.providerSessionId !== args.providerSessionId ||
            sandboxExecution.providerCommandId !== args.providerCommandId ||
            trustedGroup.timeoutSeconds === undefined ||
            sandboxExecution.policy?.timeoutSeconds !==
              trustedGroup.timeoutSeconds ||
            sandboxExecution.policy.protectedExecution === undefined ||
            sandboxExecution.policy.protectedExecution.version !== 'linux-v1' ||
            sandboxExecution.policy.protectedExecution.effectiveUid !==
              65_534 ||
            sandboxExecution.policy.protectedExecution.effectiveGid !==
              65_534 ||
            sandboxExecution.policy.protectedExecution.noNewPrivileges !==
              true ||
            sandboxExecution.policy.protectedExecution.capabilitySetsCleared !==
              true ||
            sandboxExecution.policy.protectedExecution.sourceReadOnly !==
              true ||
            sandboxExecution.policy.protectedExecution.gitMetadataReadOnly !==
              true ||
            sandboxExecution.policy.protectedExecution.privatePidNamespace !==
              true ||
            sandboxExecution.policy.protectedExecution
              .privateNetworkNamespace !== true ||
            sandboxExecution.policy.protectedExecution
              .nestedNamespaceCreationBlocked !== true ||
            sandboxExecution.policy.protectedExecution.descendantsTerminated !==
              true ||
            sandboxExecution.policy.environment === undefined ||
            sandboxExecution.policy.environment.sandboxClass !==
              'linux-container' ||
            sandboxExecution.policy.environment.sandboxClassSource !==
              'trusted-request' ||
            sandboxExecution.policy.environment.operatingSystem !== 'Linux' ||
            sandboxExecution.policy.environment.architecture !==
              args.architecture ||
            sandboxExecution.policy.environment.providerState !== 'started' ||
            sandboxExecution.policy.environment.public !== false ||
            sandboxExecution.policy.environment.linked !== false ||
            sandboxExecution.policy.environment.volumeCount !== 0 ||
            sandboxExecution.policy.environment.image !==
              args.environmentImage ||
            sandboxExecution.policy.environment.image.length === 0 ||
            sandboxExecution.policy.environment.image.length > 512 ||
            sandboxExecution.policy.environment.target.length === 0 ||
            sandboxExecution.policy.environment.target.length > 256 ||
            sandboxExecution.policy.environment.sandboxClass.length === 0 ||
            sandboxExecution.policy.environment.sandboxClass.length > 128 ||
            sandboxExecution.policy.environment.architecture.length === 0 ||
            sandboxExecution.policy.environment.architecture.length > 128 ||
            !Number.isSafeInteger(
              sandboxExecution.policy.environment.observedAt,
            ) ||
            sandboxExecution.policy.environment.observedAt <
              sandboxExecution.startedAt ||
            sandboxExecution.policy.environment.observedAt >
              sandboxExecution.completedAt ||
            sandboxExecution.policy.lifecycle.ephemeral !== true ||
            sandboxExecution.policy.lifecycle.retainAfterRun !== false ||
            sandboxExecution.policy.lifecycle.autoDeleteMinutes !== 0 ||
            sandboxExecution.policy.lifecycle.autoStopMinutes === undefined ||
            !Number.isSafeInteger(
              sandboxExecution.policy.lifecycle.autoStopMinutes,
            ) ||
            sandboxExecution.policy.lifecycle.autoStopMinutes <= 0 ||
            (sandboxExecution.policy.lifecycle.autoArchiveMinutes !==
              undefined &&
              (!Number.isSafeInteger(
                sandboxExecution.policy.lifecycle.autoArchiveMinutes,
              ) ||
                sandboxExecution.policy.lifecycle.autoArchiveMinutes < 0)) ||
            sandboxExecution.policy.resources.cpu === undefined ||
            !Number.isFinite(sandboxExecution.policy.resources.cpu) ||
            sandboxExecution.policy.resources.cpu <= 0 ||
            sandboxExecution.policy.resources.memoryGb === undefined ||
            !Number.isFinite(sandboxExecution.policy.resources.memoryGb) ||
            sandboxExecution.policy.resources.memoryGb <= 0 ||
            sandboxExecution.policy.resources.diskGb === undefined ||
            !Number.isFinite(sandboxExecution.policy.resources.diskGb) ||
            sandboxExecution.policy.resources.diskGb <= 0 ||
            (sandboxExecution.policy.network.allowList !== undefined &&
              (sandboxExecution.policy.network.allowList.length === 0 ||
                sandboxExecution.policy.network.allowList.length > 4_096)) ||
            args.completedAt - args.startedAt >
              trustedGroup.timeoutSeconds * 1_000 ||
            args.stdoutCaptureStatus !== 'captured' ||
            args.stderrCaptureStatus !== 'captured' ||
            stdoutArtifact === null ||
            stdoutArtifact.kind !== 'stdout' ||
            stderrArtifact === null ||
            stderrArtifact.kind !== 'stderr' ||
            !args.artifactIds.includes(stdoutArtifact._id) ||
            !args.artifactIds.includes(stderrArtifact._id) ||
            args.cleanupStatus !== 'deleted')) ||
        requirement.requiredArtifactKinds.some(
          (kind) => !producedArtifactKinds.includes(kind),
        ))
    ) {
      throw new ConvexError(
        'Passed verification result does not satisfy evidence invariants',
      )
    }

    if (existing !== null) {
      if (
        existing.verificationPlanId !== args.verificationPlanId ||
        existing.executionGroupId !== args.executionGroupId ||
        existing.requirementId !== args.requirementId ||
        existing.candidatePatchSetId !== args.candidatePatchSetId ||
        existing.sandboxExecutionId !== args.sandboxExecutionId ||
        existing.provider !== args.provider ||
        existing.command !== args.command ||
        existing.commandDigest !== args.commandDigest ||
        existing.platform !== args.platform ||
        existing.architecture !== args.architecture ||
        existing.environmentImage !== args.environmentImage ||
        existing.providerSessionId !== args.providerSessionId ||
        existing.providerCommandId !== args.providerCommandId ||
        existing.status !== args.status ||
        existing.exitCode !== args.exitCode ||
        existing.summary !== args.summary ||
        existing.passedCount !== args.passedCount ||
        existing.failedCount !== args.failedCount ||
        existing.skippedCount !== args.skippedCount ||
        existing.candidateDigestBefore !== args.candidateDigestBefore ||
        existing.candidateDigestAfter !== args.candidateDigestAfter ||
        existing.startedAt !== args.startedAt ||
        existing.completedAt !== args.completedAt ||
        existing.stdoutArtifactId !== args.stdoutArtifactId ||
        existing.stderrArtifactId !== args.stderrArtifactId ||
        existing.stdoutCaptureStatus !== args.stdoutCaptureStatus ||
        existing.stderrCaptureStatus !== args.stderrCaptureStatus ||
        existing.cleanupStatus !== args.cleanupStatus ||
        JSON.stringify(existing.artifactIds) !==
          JSON.stringify(args.artifactIds)
      ) {
        throw new ConvexError('Verification result idempotency key conflict')
      }
      return {
        id: existing._id,
        workflowRunId: existing.workflowRunId,
        ...(existing.verificationPlanId === undefined
          ? {}
          : { verificationPlanId: existing.verificationPlanId }),
        ...(existing.executionGroupId === undefined
          ? {}
          : { executionGroupId: existing.executionGroupId }),
        requirementId: existing.requirementId,
        candidatePatchSetId: existing.candidatePatchSetId,
        ...(existing.sandboxExecutionId === undefined
          ? {}
          : { sandboxExecutionId: existing.sandboxExecutionId }),
        provider: existing.provider,
        ...(existing.command === undefined
          ? {}
          : { command: existing.command }),
        ...(existing.commandDigest === undefined
          ? {}
          : { commandDigest: existing.commandDigest }),
        platform: existing.platform,
        architecture: existing.architecture,
        ...(existing.environmentImage === undefined
          ? {}
          : { environmentImage: existing.environmentImage }),
        status: existing.status,
        ...(existing.exitCode === undefined
          ? {}
          : { exitCode: existing.exitCode }),
        ...(existing.summary === undefined
          ? {}
          : { summary: existing.summary }),
        ...(existing.passedCount === undefined
          ? {}
          : { passedCount: existing.passedCount }),
        ...(existing.failedCount === undefined
          ? {}
          : { failedCount: existing.failedCount }),
        ...(existing.skippedCount === undefined
          ? {}
          : { skippedCount: existing.skippedCount }),
        artifactIds: existing.artifactIds,
        producedArtifactKinds: existing.producedArtifactKinds,
        ...(existing.stdoutArtifactId === undefined
          ? {}
          : { stdoutArtifactId: existing.stdoutArtifactId }),
        ...(existing.stderrArtifactId === undefined
          ? {}
          : { stderrArtifactId: existing.stderrArtifactId }),
        ...(existing.stdoutCaptureStatus === undefined
          ? {}
          : { stdoutCaptureStatus: existing.stdoutCaptureStatus }),
        ...(existing.stderrCaptureStatus === undefined
          ? {}
          : { stderrCaptureStatus: existing.stderrCaptureStatus }),
        ...(existing.cleanupStatus === undefined
          ? {}
          : { cleanupStatus: existing.cleanupStatus }),
        ...(existing.candidateDigestBefore === undefined
          ? {}
          : { candidateDigestBefore: existing.candidateDigestBefore }),
        ...(existing.candidateDigestAfter === undefined
          ? {}
          : { candidateDigestAfter: existing.candidateDigestAfter }),
        startedAt: existing.startedAt,
        ...(existing.completedAt === undefined
          ? {}
          : { completedAt: existing.completedAt }),
        idempotencyKey: existing.idempotencyKey,
      }
    }

    const result = {
      workflowRunId: args.workflowRunId,
      ...(args.verificationPlanId === undefined
        ? {}
        : { verificationPlanId: args.verificationPlanId }),
      ...(args.executionGroupId === undefined
        ? {}
        : { executionGroupId: args.executionGroupId }),
      requirementId: args.requirementId,
      candidatePatchSetId: args.candidatePatchSetId,
      ...(args.sandboxExecutionId === undefined
        ? {}
        : { sandboxExecutionId: args.sandboxExecutionId }),
      provider: args.provider,
      ...(args.command === undefined ? {} : { command: args.command }),
      ...(args.commandDigest === undefined
        ? {}
        : { commandDigest: args.commandDigest }),
      platform: args.platform,
      architecture: args.architecture,
      ...(args.environmentImage === undefined
        ? {}
        : { environmentImage: args.environmentImage }),
      ...(args.providerSessionId === undefined
        ? {}
        : { providerSessionId: args.providerSessionId }),
      ...(args.providerCommandId === undefined
        ? {}
        : { providerCommandId: args.providerCommandId }),
      status: args.status,
      ...(args.exitCode === undefined ? {} : { exitCode: args.exitCode }),
      ...(args.summary === undefined ? {} : { summary: args.summary }),
      ...(args.passedCount === undefined
        ? {}
        : { passedCount: args.passedCount }),
      ...(args.failedCount === undefined
        ? {}
        : { failedCount: args.failedCount }),
      ...(args.skippedCount === undefined
        ? {}
        : { skippedCount: args.skippedCount }),
      artifactIds: args.artifactIds,
      producedArtifactKinds,
      ...(args.stdoutArtifactId === undefined
        ? {}
        : { stdoutArtifactId: args.stdoutArtifactId }),
      ...(args.stderrArtifactId === undefined
        ? {}
        : { stderrArtifactId: args.stderrArtifactId }),
      ...(args.stdoutCaptureStatus === undefined
        ? {}
        : { stdoutCaptureStatus: args.stdoutCaptureStatus }),
      ...(args.stderrCaptureStatus === undefined
        ? {}
        : { stderrCaptureStatus: args.stderrCaptureStatus }),
      ...(args.cleanupStatus === undefined
        ? {}
        : { cleanupStatus: args.cleanupStatus }),
      ...(args.candidateDigestBefore === undefined
        ? {}
        : { candidateDigestBefore: args.candidateDigestBefore }),
      ...(args.candidateDigestAfter === undefined
        ? {}
        : { candidateDigestAfter: args.candidateDigestAfter }),
      startedAt: args.startedAt,
      ...(args.completedAt === undefined
        ? {}
        : { completedAt: args.completedAt }),
      idempotencyKey: args.idempotencyKey,
    }
    const id = await ctx.db.insert('verificationResults', result)
    if (executionGroup !== null) {
      await ctx.db.patch('verificationExecutionGroups', executionGroup._id, {
        status:
          args.status === 'blocked'
            ? 'blocked'
            : args.status === 'cancelled'
              ? 'cancelled'
              : args.status === 'passed' || args.status === 'failed'
                ? 'completed'
                : 'failed',
        completedAt: args.completedAt ?? args.startedAt,
      })
    }
    return { id, ...result }
  },
})

export const verificationResultFunctions = {
  recordVerificationResult,
}
