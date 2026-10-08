import type { Doc, Id } from '../../_generated/dataModel'
import { ConvexError } from 'convex/values'
import type { MutationCtx, QueryCtx } from '../../_generated/server'

export async function sha256Digest(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  return `sha256:${hex}`
}

export function isGitCommitSha(value: string) {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)
}

export function requireIncomingPullRequestIdentity(externalRef: {
  provider: string
  eventKind: string
  repositoryProvider?: string
  repositoryExternalId?: string
  repositoryOwner?: string
  repositoryName?: string
  repositoryFullName?: string
  issueExternalId?: string
  pullRequestExternalId?: string
  pullRequestNumber?: number
  pullRequestUpdatedAt?: number
  pullRequestBaseSha?: string
  pullRequestHeadSha?: string
  pullRequestPreviousHeadSha?: string
}) {
  if (
    externalRef.provider !== 'github' ||
    externalRef.repositoryProvider !== 'github' ||
    !['github.pull_request.opened', 'github.pull_request.synchronize'].includes(
      externalRef.eventKind,
    ) ||
    externalRef.repositoryExternalId === undefined ||
    externalRef.repositoryExternalId.trim().length === 0 ||
    externalRef.repositoryOwner === undefined ||
    externalRef.repositoryOwner.trim().length === 0 ||
    externalRef.repositoryName === undefined ||
    externalRef.repositoryName.trim().length === 0 ||
    externalRef.repositoryFullName === undefined ||
    externalRef.repositoryFullName.trim().length === 0 ||
    externalRef.issueExternalId === undefined ||
    externalRef.issueExternalId.trim().length === 0 ||
    externalRef.pullRequestExternalId === undefined ||
    externalRef.pullRequestExternalId.trim().length === 0 ||
    externalRef.repositoryFullName !==
      `${externalRef.repositoryOwner}/${externalRef.repositoryName}` ||
    externalRef.issueExternalId !== externalRef.pullRequestExternalId ||
    externalRef.pullRequestNumber === undefined ||
    !Number.isSafeInteger(externalRef.pullRequestNumber) ||
    externalRef.pullRequestNumber <= 0 ||
    externalRef.pullRequestUpdatedAt === undefined ||
    !Number.isSafeInteger(externalRef.pullRequestUpdatedAt) ||
    externalRef.pullRequestUpdatedAt < 0 ||
    externalRef.pullRequestBaseSha === undefined ||
    !isGitCommitSha(externalRef.pullRequestBaseSha) ||
    externalRef.pullRequestHeadSha === undefined ||
    !isGitCommitSha(externalRef.pullRequestHeadSha) ||
    (externalRef.eventKind === 'github.pull_request.synchronize'
      ? externalRef.pullRequestPreviousHeadSha === undefined ||
        !isGitCommitSha(externalRef.pullRequestPreviousHeadSha)
      : externalRef.pullRequestPreviousHeadSha !== undefined)
  ) {
    throw new ConvexError(
      'External workflow intake requires complete valid GitHub pull request identity',
    )
  }
  return {
    provider: externalRef.provider,
    eventKind: externalRef.eventKind,
    repositoryProvider: externalRef.repositoryProvider,
    repositoryExternalId: externalRef.repositoryExternalId,
    repositoryOwner: externalRef.repositoryOwner,
    repositoryName: externalRef.repositoryName,
    repositoryFullName: externalRef.repositoryFullName,
    issueExternalId: externalRef.issueExternalId,
    pullRequestExternalId: externalRef.pullRequestExternalId,
    pullRequestNumber: externalRef.pullRequestNumber,
    pullRequestUpdatedAt: externalRef.pullRequestUpdatedAt,
    pullRequestBaseSha: externalRef.pullRequestBaseSha,
    pullRequestHeadSha: externalRef.pullRequestHeadSha,
    ...(externalRef.pullRequestPreviousHeadSha === undefined
      ? {}
      : { pullRequestPreviousHeadSha: externalRef.pullRequestPreviousHeadSha }),
  }
}

export function requireSystemIngestionSecret(secret: string) {
  const expected = process.env.PATCHPLANE_SYSTEM_INGESTION_SECRET

  if (expected === undefined || expected.length === 0 || secret !== expected) {
    throw new ConvexError('System ingestion secret required')
  }
}

export async function requireWorkflowRun(
  ctx: QueryCtx | MutationCtx,
  workflowRunId: Id<'workflowRuns'>,
) {
  const workflowRun = await ctx.db.get('workflowRuns', workflowRunId)
  if (workflowRun === null) {
    throw new ConvexError('Workflow run not found')
  }
  return workflowRun
}

export async function isLatestWorkflowAttempt(
  ctx: QueryCtx | MutationCtx,
  workflowRun: {
    _id: Id<'workflowRuns'>
    rootWorkflowRunId?: Id<'workflowRuns'>
    modelVersion?: 'v1'
  },
) {
  if (workflowRun.modelVersion !== 'v1') return true
  const latest = await ctx.db
    .query('workflowRuns')
    .withIndex('by_root_attempt', (q) =>
      q.eq(
        'rootWorkflowRunId',
        workflowRun.rootWorkflowRunId ?? workflowRun._id,
      ),
    )
    .order('desc')
    .first()
  return latest === null || latest._id === workflowRun._id
}

export async function requireReviewRunForWorkflow(
  ctx: QueryCtx | MutationCtx,
  reviewRunId: Id<'reviewRuns'>,
  workflowRunId: Id<'workflowRuns'>,
) {
  const reviewRun = await ctx.db.get('reviewRuns', reviewRunId)
  if (reviewRun === null || reviewRun.workflowRunId !== workflowRunId) {
    throw new ConvexError('Review run not found')
  }
  return reviewRun
}

export async function requireEvidenceArtifactForWorkflow(
  ctx: QueryCtx | MutationCtx,
  artifactId: Id<'evidenceArtifacts'>,
  workflowRunId: Id<'workflowRuns'>,
) {
  const artifact = await ctx.db.get('evidenceArtifacts', artifactId)
  if (artifact === null || artifact.workflowRunId !== workflowRunId) {
    throw new ConvexError('Evidence artifact not found')
  }
  return artifact
}

export async function insertProvenanceEvent(
  ctx: MutationCtx,
  input: {
    workflowRunId: Id<'workflowRuns'>
    traceId: string
    parentEventId?: string | undefined
    type: string
    operation: string
    pluginName?: string | undefined
    status: 'started' | 'succeeded' | 'failed' | 'blocked'
    startedAt: number
    completedAt?: number | undefined
    summary?: string | undefined
    artifactRefs?: ReadonlyArray<string> | undefined
    errorCategory?: string | undefined
    idempotencyKey?: string | undefined
  },
) {
  if (input.idempotencyKey !== undefined) {
    const existing = await ctx.db
      .query('provenanceEvents')
      .withIndex('by_workflow_event_key', (q) =>
        q
          .eq('workflowRunId', input.workflowRunId)
          .eq('idempotencyKey', input.idempotencyKey),
      )
      .unique()

    if (existing !== null) {
      const updated = {
        traceId: input.traceId,
        parentEventId: input.parentEventId,
        type: input.type,
        operation: input.operation,
        pluginName: input.pluginName,
        status: input.status,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        summary: input.summary,
        artifactRefs: [...(input.artifactRefs ?? [])],
        errorCategory: input.errorCategory,
        idempotencyKey: input.idempotencyKey,
      }
      await ctx.db.patch('provenanceEvents', existing._id, updated)
      return {
        id: existing._id,
        workflowRunId: existing.workflowRunId,
        traceId: updated.traceId,
        ...(updated.parentEventId === undefined
          ? {}
          : { parentEventId: updated.parentEventId }),
        sequence: existing.sequence,
        type: updated.type,
        operation: updated.operation,
        ...(updated.pluginName === undefined
          ? {}
          : { pluginName: updated.pluginName }),
        status: updated.status,
        startedAt: updated.startedAt,
        ...(updated.completedAt === undefined
          ? {}
          : { completedAt: updated.completedAt }),
        ...(updated.summary === undefined ? {} : { summary: updated.summary }),
        artifactRefs: updated.artifactRefs,
        ...(updated.errorCategory === undefined
          ? {}
          : { errorCategory: updated.errorCategory }),
        idempotencyKey: updated.idempotencyKey,
      }
    }
  }

  const latest = await ctx.db
    .query('provenanceEvents')
    .withIndex('by_workflow_sequence', (q) =>
      q.eq('workflowRunId', input.workflowRunId),
    )
    .order('desc')
    .first()
  const sequence = latest === null ? 1 : latest.sequence + 1
  const event = {
    workflowRunId: input.workflowRunId,
    traceId: input.traceId,
    ...(input.parentEventId === undefined
      ? {}
      : { parentEventId: input.parentEventId }),
    sequence,
    type: input.type,
    operation: input.operation,
    ...(input.pluginName === undefined ? {} : { pluginName: input.pluginName }),
    status: input.status,
    startedAt: input.startedAt,
    ...(input.completedAt === undefined
      ? {}
      : { completedAt: input.completedAt }),
    ...(input.summary === undefined ? {} : { summary: input.summary }),
    artifactRefs: [...(input.artifactRefs ?? [])],
    ...(input.errorCategory === undefined
      ? {}
      : { errorCategory: input.errorCategory }),
    ...(input.idempotencyKey === undefined
      ? {}
      : { idempotencyKey: input.idempotencyKey }),
  }
  const id = await ctx.db.insert('provenanceEvents', event)

  return { id, ...event }
}

export function normalizeCanonicalJson(candidate: unknown): unknown {
  if (Array.isArray(candidate)) return candidate.map(normalizeCanonicalJson)
  if (candidate !== null && typeof candidate === 'object') {
    const entries = Object.entries(candidate).filter(
      ([, entry]) => entry !== undefined,
    )
    for (let index = 1; index < entries.length; index += 1) {
      const current = entries[index]
      if (current === undefined) continue
      let position = index - 1
      while (position >= 0) {
        const previous = entries[position]
        if (previous === undefined || previous[0] <= current[0]) break
        entries[position + 1] = previous
        position -= 1
      }
      entries[position + 1] = current
    }
    return Object.fromEntries(
      entries.map(([key, entry]) => [key, normalizeCanonicalJson(entry)]),
    )
  }
  return candidate
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeCanonicalJson(value))
}

export async function verificationPlanDigest(input: {
  readonly version: 'verification-plan-v1'
  readonly sources: ReadonlyArray<unknown>
  readonly requirements: ReadonlyArray<unknown>
}) {
  const bytes = new TextEncoder().encode(
    canonicalJson({
      version: input.version,
      sources: input.sources,
      requirements: input.requirements,
    }),
  )
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return `sha256:${Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')}`
}

export function verificationExecutionGroupValue(
  group: Doc<'verificationExecutionGroups'>,
) {
  return {
    id: group._id,
    workflowRunId: group.workflowRunId,
    verificationPlanId: group.verificationPlanId,
    requirementId: group.requirementId,
    candidatePatchSetId: group.candidatePatchSetId,
    stableKey: group.stableKey,
    provider: group.provider,
    platform: group.platform,
    architecture: group.architecture,
    ...(group.commandDigest === undefined
      ? {}
      : { commandDigest: group.commandDigest }),
    ...(group.timeoutSeconds === undefined
      ? {}
      : { timeoutSeconds: group.timeoutSeconds }),
    sharedState: group.sharedState,
    status: group.status,
    ...(group.sandboxId === undefined ? {} : { sandboxId: group.sandboxId }),
    ...(group.providerSessionId === undefined
      ? {}
      : { providerSessionId: group.providerSessionId }),
    ...(group.providerCommandId === undefined
      ? {}
      : { providerCommandId: group.providerCommandId }),
    ...(group.sandboxExecutionId === undefined
      ? {}
      : { sandboxExecutionId: group.sandboxExecutionId }),
    claimedAt: group.claimedAt,
    ...(group.startedAt === undefined ? {} : { startedAt: group.startedAt }),
    ...(group.completedAt === undefined
      ? {}
      : { completedAt: group.completedAt }),
  }
}

export function verificationResultValue(result: Doc<'verificationResults'>) {
  return {
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
    ...(result.providerSessionId === undefined
      ? {}
      : { providerSessionId: result.providerSessionId }),
    ...(result.providerCommandId === undefined
      ? {}
      : { providerCommandId: result.providerCommandId }),
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
  }
}

export function sandboxExecutionValue(execution: Doc<'sandboxExecutions'>) {
  return {
    id: execution._id,
    workflowRunId: execution.workflowRunId,
    ...(execution.executionGroupId === undefined
      ? {}
      : { executionGroupId: execution.executionGroupId }),
    ...(execution.idempotencyKey === undefined
      ? {}
      : { idempotencyKey: execution.idempotencyKey }),
    provider: execution.provider,
    sandboxId: execution.sandboxId,
    ...(execution.providerSessionId === undefined
      ? {}
      : { providerSessionId: execution.providerSessionId }),
    ...(execution.providerCommandId === undefined
      ? {}
      : { providerCommandId: execution.providerCommandId }),
    command: execution.command,
    status: execution.status,
    ...(execution.exitCode === undefined
      ? {}
      : { exitCode: execution.exitCode }),
    stdout: execution.stdout,
    ...(execution.stderr === undefined ? {} : { stderr: execution.stderr }),
    ...(execution.policy === undefined ? {} : { policy: execution.policy }),
    startedAt: execution.startedAt,
    completedAt: execution.completedAt,
  }
}
