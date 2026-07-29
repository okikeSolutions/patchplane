import type { UserIdentity } from 'convex/server'
import type { Doc, Id } from './_generated/dataModel'
import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server'

const incomingDispatchRecoveryTimeoutMs = 60 * 60 * 1_000
const verificationExecutionGroupRecoveryTimeoutMs = 60 * 60 * 1_000
const workflowDetailRuntimeEventLimit = 100
const workflowDetailRuntimePayloadPreviewLength = 8_000
const workflowDetailSandboxExecutionLimit = 32
const workflowDetailSandboxCommandPreviewLength = 1_000
const workflowDetailSandboxOutputPreviewLength = 16_000

function isEpochMillis(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

function isValidProviderProcessIdentityPair(
  sessionId: string | undefined,
  commandId: string | undefined,
): boolean {
  return (
    (sessionId === undefined && commandId === undefined) ||
    (sessionId !== undefined &&
      sessionId.length > 0 &&
      sessionId.length <= 256 &&
      commandId !== undefined &&
      commandId.length > 0 &&
      commandId.length <= 256)
  )
}
const workflowDetailVerificationRequirementLimit = 64
const workflowDetailVerificationResultLimit = 128
const workflowDetailRuntimeSessionLimit = 32
const workflowDetailEvidenceArtifactLimit = 64
const workflowDetailCandidatePatchSetLimit = 32
const workflowDetailReviewRunLimit = 32
const workflowDetailReviewFindingLimit = 128
const workflowDetailPolicyDecisionLimit = 32
const workflowDetailHumanDecisionLimit = 32
const workflowDetailPublicationResultLimit = 64
const workflowDetailProvenanceEventLimit = 128

function publicationResultFromDocument(result: Doc<'publicationResults'>) {
  return {
    id: result._id,
    workflowRunId: result.workflowRunId,
    ...(result.humanDecisionId === undefined
      ? {}
      : { humanDecisionId: result.humanDecisionId }),
    ...(result.candidatePatchSetId === undefined
      ? {}
      : { candidatePatchSetId: result.candidatePatchSetId }),
    ...(result.targetSha === undefined ? {} : { targetSha: result.targetSha }),
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
  }
}

function runtimePayloadPreview(payloadJson: string | undefined) {
  if (
    payloadJson === undefined ||
    payloadJson.length <= workflowDetailRuntimePayloadPreviewLength
  ) {
    return payloadJson
  }

  return `${payloadJson.slice(0, workflowDetailRuntimePayloadPreviewLength)}\n…truncated; full runtime output remains in the workflow evidence artifact…`
}

function sandboxOutputPreview(output: string | undefined) {
  if (
    output === undefined ||
    output.length <= workflowDetailSandboxOutputPreviewLength
  ) {
    return output
  }

  return `${output.slice(0, workflowDetailSandboxOutputPreviewLength)}\n…truncated; full sandbox output remains in the workflow evidence artifact…`
}

function sandboxCommandPreview(command: string) {
  const redacted = command
    .replaceAll(
      /(\b(?:api[_-]?key|password|secret|token)[a-z0-9_-]*\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1[redacted]',
    )
    .replaceAll(
      /(\B--?(?:api[_-]?key|password|secret|token)[a-z0-9_-]*(?:=|\s+))(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1[redacted]',
    )
    .replaceAll(/\bBearer\s+[a-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')

  return redacted.length <= workflowDetailSandboxCommandPreviewLength
    ? redacted
    : `${redacted.slice(0, workflowDetailSandboxCommandPreviewLength)}…`
}

function sandboxRuntimeModel(command: string) {
  const match =
    /(?:^|\s)["']?--model["']?(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s]+))/i.exec(
      command,
    )
  return match?.slice(1).find((value) => value !== undefined)
}

function workOSOrganizationId(identity: UserIdentity) {
  const value =
    identity.organizationId ??
    identity.orgId ??
    identity.organization_id ??
    identity.org_id

  return typeof value === 'string' && value.length > 0 ? value : null
}

function requireWorkOSWorkspace(identity: UserIdentity, workspaceId: string) {
  const organizationId = workOSOrganizationId(identity)

  if (organizationId === null) {
    throw new ConvexError('Active WorkOS organization required')
  }

  if (workspaceId !== `workos:${organizationId}`) {
    throw new ConvexError('Workspace mismatch')
  }
}

async function requireWorkOSIdentity(ctx: {
  auth: { getUserIdentity(): Promise<UserIdentity | null> }
}) {
  const identity = await ctx.auth.getUserIdentity()

  if (identity === null) {
    throw new ConvexError('Authentication required')
  }

  return identity
}

function workspaceOrganizationId(workspaceId: string) {
  return workspaceId.startsWith('workos:')
    ? workspaceId.slice('workos:'.length)
    : null
}

async function requireMembershipPermission(
  ctx: QueryCtx | MutationCtx,
  identity: UserIdentity,
  workspaceId: string,
  permission: string,
) {
  const organizationId = workspaceOrganizationId(workspaceId)

  if (organizationId === null) {
    throw new ConvexError('WorkOS workspace required')
  }

  const memberships = await ctx.db
    .query('memberships')
    .withIndex('by_auth_and_org', (q) =>
      q.eq('authId', identity.subject).eq('organizationId', organizationId),
    )
    .collect()
  const activeMemberships = memberships.filter(
    (membership) => membership.status === 'active',
  )

  if (activeMemberships.length === 0) {
    throw new ConvexError('Active membership required')
  }

  const membershipWithPermission = activeMemberships.find((membership) =>
    membership.permissions.includes(permission),
  )

  if (membershipWithPermission === undefined) {
    throw new ConvexError('Permission required')
  }

  return membershipWithPermission
}

const externalWorkflowRefArg = v.object({
  provider: v.string(),
  deliveryId: v.string(),
  eventKind: v.string(),
  repositoryProvider: v.optional(v.string()),
  repositoryInstallationId: v.optional(v.string()),
  repositoryExternalId: v.optional(v.string()),
  repositoryOwner: v.optional(v.string()),
  repositoryName: v.optional(v.string()),
  repositoryFullName: v.optional(v.string()),
  issueExternalId: v.optional(v.string()),
  issueNumber: v.optional(v.number()),
  issueTitle: v.optional(v.string()),
  issueBody: v.optional(v.string()),
  pullRequestExternalId: v.optional(v.string()),
  pullRequestNumber: v.optional(v.number()),
  pullRequestUpdatedAt: v.optional(v.number()),
  pullRequestBaseSha: v.optional(v.string()),
  pullRequestHeadSha: v.optional(v.string()),
  pullRequestPreviousHeadSha: v.optional(v.string()),
  pullRequestHeadRef: v.optional(v.string()),
  pullRequestBaseRef: v.optional(v.string()),
  commentExternalId: v.optional(v.string()),
  url: v.optional(v.string()),
  senderProvider: v.optional(v.string()),
  senderExternalId: v.optional(v.string()),
  senderLogin: v.optional(v.string()),
})

const workflowStartArgs = {
  workspaceId: v.string(),
  actorId: v.string(),
  actorDisplayName: v.string(),
  source: v.union(v.literal('dev'), v.literal('app'), v.literal('external')),
  traceId: v.string(),
  prompt: v.string(),
}

const sandboxPolicyArg = v.object({
  lifecycle: v.object({
    ephemeral: v.boolean(),
    retainAfterRun: v.boolean(),
    autoStopMinutes: v.optional(v.number()),
    autoArchiveMinutes: v.optional(v.number()),
    autoDeleteMinutes: v.optional(v.number()),
  }),
  network: v.object({
    blockAll: v.optional(v.boolean()),
    allowList: v.optional(v.string()),
  }),
  resources: v.object({
    cpu: v.optional(v.number()),
    memoryGb: v.optional(v.number()),
    diskGb: v.optional(v.number()),
  }),
  environment: v.optional(
    v.object({
      sandboxClass: v.string(),
      sandboxClassSource: v.literal('trusted-request'),
      operatingSystem: v.string(),
      architecture: v.string(),
      image: v.string(),
      target: v.string(),
      providerState: v.string(),
      public: v.boolean(),
      linked: v.boolean(),
      volumeCount: v.number(),
      observedAt: v.number(),
    }),
  ),
  timeoutSeconds: v.optional(v.number()),
})

function sortedByNumber<A>(
  items: ReadonlyArray<A>,
  value: (item: A) => number,
): Array<A> {
  return items.reduce<Array<A>>((sorted, item) => {
    const insertAt = sorted.findIndex(
      (candidate) => value(item) < value(candidate),
    )

    if (insertAt === -1) {
      return [...sorted, item]
    }

    return [...sorted.slice(0, insertAt), item, ...sorted.slice(insertAt)]
  }, [])
}

const evidenceArtifactKindArg = v.union(
  v.literal('raw-trace'),
  v.literal('stdout'),
  v.literal('stderr'),
  v.literal('diff'),
  v.literal('test-report'),
  v.literal('screenshot'),
  v.literal('video'),
  v.literal('policy-result'),
  v.literal('trust-report'),
)

const evidenceArtifactReturn = v.object({
  id: v.string(),
  workflowRunId: v.string(),
  producer: v.optional(v.string()),
  subjectDigest: v.optional(v.string()),
  traceId: v.optional(v.string()),
  kind: evidenceArtifactKindArg,
  label: v.optional(v.string()),
  storageProvider: v.literal('cloudflare-r2'),
  storageKey: v.string(),
  contentType: v.string(),
  sizeBytes: v.number(),
  sha256: v.string(),
  retentionPolicy: v.optional(v.string()),
  createdAt: v.number(),
})

const candidateSubjectArg = v.union(
  v.object({
    kind: v.literal('incoming-pull-request'),
    repositoryProvider: v.literal('github'),
    repositoryExternalId: v.string(),
    repositoryOwner: v.string(),
    repositoryName: v.string(),
    repositoryFullName: v.string(),
    pullRequestExternalId: v.string(),
    pullRequestNumber: v.number(),
    baseSha: v.string(),
    headSha: v.string(),
    sourceEventProvider: v.literal('github'),
    sourceEventDeliveryId: v.string(),
    sourceEventKind: v.union(
      v.literal('github.pull_request.opened'),
      v.literal('github.pull_request.synchronize'),
    ),
  }),
  v.object({
    kind: v.literal('sandbox-generated'),
    sandboxExecutionId: v.id('sandboxExecutions'),
  }),
)

const candidatePatchSetStatusArg = v.union(
  v.literal('captured'),
  v.literal('empty'),
  v.literal('failed'),
)

const candidatePatchSetStatsArg = v.object({
  filesChanged: v.number(),
  additions: v.number(),
  deletions: v.number(),
})

const candidatePatchSetReturn = v.object({
  id: v.string(),
  workflowRunId: v.string(),
  sandboxExecutionId: v.optional(v.string()),
  subject: v.optional(candidateSubjectArg),
  status: candidatePatchSetStatusArg,
  candidateDigest: v.optional(v.string()),
  baseRef: v.optional(v.string()),
  baseSha: v.optional(v.string()),
  headRef: v.optional(v.string()),
  headSha: v.optional(v.string()),
  diffArtifactId: v.optional(v.string()),
  summary: v.optional(v.string()),
  stats: v.optional(candidatePatchSetStatsArg),
  idempotencyKey: v.optional(v.string()),
  createdAt: v.number(),
})

const verificationRequirementKindArg = v.union(
  v.literal('test'),
  v.literal('lint'),
  v.literal('build'),
  v.literal('browser'),
  v.literal('security'),
  v.literal('review'),
)

const verificationRequirementSourceArg = v.union(
  v.literal('repository-config'),
  v.literal('intake'),
  v.literal('policy'),
  v.literal('human'),
)

const verificationPlatformArg = v.union(
  v.literal('linux'),
  v.literal('windows'),
  v.literal('macos'),
)

const verificationExecutionGroupStatusArg = v.union(
  v.literal('claimed'),
  v.literal('running'),
  v.literal('completed'),
  v.literal('failed'),
  v.literal('blocked'),
  v.literal('cancelled'),
)

const verificationLogCaptureStatusArg = v.union(
  v.literal('captured'),
  v.literal('truncated'),
  v.literal('failed'),
)

const sandboxCleanupStatusArg = v.union(
  v.literal('deleted'),
  v.literal('failed'),
  v.literal('retained'),
  v.literal('not-started'),
)

const verificationResultStatusArg = v.union(
  v.literal('queued'),
  v.literal('running'),
  v.literal('passed'),
  v.literal('failed'),
  v.literal('error'),
  v.literal('blocked'),
  v.literal('cancelled'),
  v.literal('skipped'),
  v.literal('invalidated'),
)

const verificationPlanSourceArg = v.object({
  kind: v.union(
    v.literal('deployment-system'),
    v.literal('workspace-policy'),
    v.literal('base-repository-policy'),
  ),
  revision: v.string(),
  workspaceId: v.optional(v.string()),
  repositoryFullName: v.optional(v.string()),
  baseSha: v.optional(v.string()),
})

const verificationPlanRequirementArg = v.object({
  key: v.string(),
  label: v.string(),
  kind: verificationRequirementKindArg,
  required: v.boolean(),
  command: v.optional(v.string()),
  platform: v.optional(verificationPlatformArg),
  architecture: v.optional(v.string()),
  timeoutSeconds: v.optional(v.number()),
  requiredArtifactKinds: v.array(evidenceArtifactKindArg),
})

const verificationPlanReturn = v.object({
  id: v.id('verificationPlans'),
  workflowRunId: v.id('workflowRuns'),
  version: v.literal('verification-plan-v1'),
  sources: v.array(verificationPlanSourceArg),
  requirements: v.array(verificationPlanRequirementArg),
  digest: v.string(),
  createdAt: v.number(),
})

const verificationRequirementReturn = v.object({
  id: v.id('verificationRequirements'),
  workflowRunId: v.id('workflowRuns'),
  verificationPlanId: v.optional(v.id('verificationPlans')),
  key: v.string(),
  label: v.string(),
  kind: verificationRequirementKindArg,
  required: v.boolean(),
  command: v.optional(v.string()),
  platform: v.optional(verificationPlatformArg),
  architecture: v.optional(v.string()),
  timeoutSeconds: v.optional(v.number()),
  requiredArtifactKinds: v.array(evidenceArtifactKindArg),
  source: verificationRequirementSourceArg,
  createdAt: v.number(),
})

const verificationExecutionGroupReturn = v.object({
  id: v.id('verificationExecutionGroups'),
  workflowRunId: v.id('workflowRuns'),
  verificationPlanId: v.id('verificationPlans'),
  requirementId: v.id('verificationRequirements'),
  candidatePatchSetId: v.id('candidatePatchSets'),
  stableKey: v.string(),
  provider: v.string(),
  platform: verificationPlatformArg,
  architecture: v.string(),
  commandDigest: v.optional(v.string()),
  timeoutSeconds: v.optional(v.number()),
  sharedState: v.literal(false),
  status: verificationExecutionGroupStatusArg,
  sandboxId: v.optional(v.string()),
  providerSessionId: v.optional(v.string()),
  providerCommandId: v.optional(v.string()),
  sandboxExecutionId: v.optional(v.id('sandboxExecutions')),
  claimedAt: v.number(),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
})

const verificationResultReturn = v.object({
  id: v.id('verificationResults'),
  workflowRunId: v.id('workflowRuns'),
  verificationPlanId: v.optional(v.id('verificationPlans')),
  executionGroupId: v.optional(v.id('verificationExecutionGroups')),
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
  producedArtifactKinds: v.array(evidenceArtifactKindArg),
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
})

const reviewRunKindArg = v.union(
  v.literal('test'),
  v.literal('lint'),
  v.literal('policy'),
  v.literal('manual'),
)

const reviewRunStatusArg = v.union(
  v.literal('queued'),
  v.literal('running'),
  v.literal('completed'),
  v.literal('failed'),
)

const reviewRunReturn = v.object({
  id: v.string(),
  workflowRunId: v.string(),
  sandboxExecutionId: v.optional(v.string()),
  candidatePatchSetId: v.optional(v.string()),
  kind: reviewRunKindArg,
  reviewer: v.string(),
  status: reviewRunStatusArg,
  summary: v.optional(v.string()),
  startedAt: v.number(),
  completedAt: v.optional(v.number()),
  idempotencyKey: v.optional(v.string()),
  createdAt: v.number(),
})

const reviewFindingSeverityArg = v.union(
  v.literal('info'),
  v.literal('warning'),
  v.literal('error'),
  v.literal('critical'),
)

const reviewFindingCategoryArg = v.union(
  v.literal('test'),
  v.literal('lint'),
  v.literal('security'),
  v.literal('policy'),
  v.literal('quality'),
  v.literal('unknown'),
)

const reviewFindingReturn = v.object({
  id: v.string(),
  workflowRunId: v.string(),
  reviewRunId: v.optional(v.string()),
  severity: reviewFindingSeverityArg,
  category: reviewFindingCategoryArg,
  message: v.string(),
  path: v.optional(v.string()),
  startLine: v.optional(v.number()),
  endLine: v.optional(v.number()),
  evidenceArtifactId: v.optional(v.string()),
  idempotencyKey: v.optional(v.string()),
  createdAt: v.number(),
})

const decisionStatusArg = v.union(
  v.literal('approved'),
  v.literal('rejected'),
  v.literal('changes-requested'),
)

const policyDecisionStatusArg = v.union(
  v.literal('approved'),
  v.literal('rejected'),
  v.literal('changes-requested'),
  v.literal('manual-review'),
)

const policyDecisionReturn = v.object({
  id: v.string(),
  workflowRunId: v.string(),
  reviewRunId: v.optional(v.string()),
  candidatePatchSetId: v.optional(v.string()),
  status: policyDecisionStatusArg,
  summary: v.string(),
  reason: v.optional(v.string()),
  policyVersion: v.optional(v.string()),
  inputDigest: v.optional(v.string()),
  verificationResultIds: v.optional(v.array(v.string())),
  reviewFindingIds: v.optional(v.array(v.string())),
  missingRequirementIds: v.optional(v.array(v.string())),
  idempotencyKey: v.optional(v.string()),
  createdAt: v.number(),
})

const humanDecisionReturn = v.object({
  id: v.string(),
  workflowRunId: v.string(),
  sandboxExecutionId: v.optional(v.string()),
  candidatePatchSetId: v.optional(v.string()),
  reviewRunId: v.optional(v.string()),
  policyDecisionId: v.optional(v.string()),
  actorId: v.string(),
  status: decisionStatusArg,
  comment: v.string(),
  verificationOverride: v.optional(v.boolean()),
  verificationOverrideReason: v.optional(v.string()),
  decidedAt: v.number(),
  idempotencyKey: v.optional(v.string()),
})

const publicationResultKindArg = v.union(
  v.literal('issue-comment'),
  v.literal('check-run'),
  v.literal('draft-pull-request'),
  v.literal('branch'),
)

const publicationResultStatusArg = v.union(
  v.literal('pending'),
  v.literal('published'),
  v.literal('failed'),
)

const publicationResultReturn = v.object({
  id: v.string(),
  workflowRunId: v.string(),
  humanDecisionId: v.optional(v.string()),
  candidatePatchSetId: v.optional(v.string()),
  targetSha: v.optional(v.string()),
  provider: v.string(),
  kind: publicationResultKindArg,
  status: publicationResultStatusArg,
  externalId: v.optional(v.string()),
  url: v.optional(v.string()),
  summary: v.optional(v.string()),
  error: v.optional(v.string()),
  dispatchToken: v.optional(v.string()),
  createdAt: v.number(),
  idempotencyKey: v.optional(v.string()),
})

const provenanceEventStatusArg = v.union(
  v.literal('started'),
  v.literal('succeeded'),
  v.literal('failed'),
  v.literal('blocked'),
)

const provenanceEventReturn = v.object({
  id: v.string(),
  workflowRunId: v.string(),
  traceId: v.string(),
  parentEventId: v.optional(v.string()),
  sequence: v.number(),
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
})

const runtimeEventReturn = v.object({
  id: v.string(),
  workflowRunId: v.string(),
  provider: v.string(),
  type: v.string(),
  occurredAt: v.number(),
  summary: v.optional(v.string()),
  payloadJson: v.optional(v.string()),
  idempotencyKey: v.optional(v.string()),
  sourceSessionId: v.optional(v.string()),
  sourceCommandId: v.optional(v.string()),
  sourceStream: v.optional(v.union(v.literal('stdout'), v.literal('stderr'))),
  sourceLine: v.optional(v.number()),
  sourceOffset: v.optional(v.number()),
})

const runtimeSessionStatusArg = v.union(
  v.literal('starting'),
  v.literal('running'),
  v.literal('completed'),
  v.literal('failed'),
  v.literal('cancelled'),
)

const runtimeSessionReturn = v.object({
  id: v.string(),
  workflowRunId: v.string(),
  provider: v.string(),
  sandboxId: v.string(),
  sessionId: v.string(),
  commandId: v.string(),
  status: runtimeSessionStatusArg,
  startedAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
})

const sandboxExecutionReturn = v.object({
  id: v.string(),
  workflowRunId: v.string(),
  executionGroupId: v.optional(v.string()),
  idempotencyKey: v.optional(v.string()),
  provider: v.string(),
  sandboxId: v.string(),
  providerSessionId: v.optional(v.string()),
  providerCommandId: v.optional(v.string()),
  command: v.string(),
  runtimeModel: v.optional(v.string()),
  status: v.union(v.literal('succeeded'), v.literal('failed')),
  exitCode: v.optional(v.number()),
  stdout: v.string(),
  stderr: v.optional(v.string()),
  policy: v.optional(sandboxPolicyArg),
  startedAt: v.number(),
  completedAt: v.number(),
})

const workflowDetailReturn = v.object({
  promptRequest: v.object({
    id: v.string(),
    workspaceId: v.string(),
    actorId: v.string(),
    traceId: v.string(),
    source: v.union(v.literal('dev'), v.literal('app'), v.literal('external')),
    prompt: v.string(),
    externalRef: v.optional(externalWorkflowRefArg),
    status: v.literal('created'),
    createdAt: v.number(),
  }),
  workflowRun: v.object({
    id: v.string(),
    promptRequestId: v.string(),
    workspaceId: v.string(),
    traceId: v.string(),
    status: v.union(
      v.literal('queued'),
      v.literal('running'),
      v.literal('reviewed'),
      v.literal('failed'),
    ),
    modelVersion: v.optional(v.literal('v1')),
    parentWorkflowRunId: v.optional(v.id('workflowRuns')),
    rootWorkflowRunId: v.optional(v.id('workflowRuns')),
    attemptNumber: v.optional(v.number()),
    trigger: v.optional(v.union(v.literal('intake'), v.literal('rerun'))),
    candidateIdentityVersion: v.optional(v.literal('incoming-pr-v1')),
    sourceBaseSha: v.optional(v.string()),
    sourceCommitSha: v.optional(v.string()),
    createdAt: v.number(),
  }),
  newerAttempt: v.optional(
    v.object({
      workflowRunId: v.string(),
      attemptNumber: v.number(),
      status: v.union(
        v.literal('queued'),
        v.literal('running'),
        v.literal('reviewed'),
        v.literal('failed'),
      ),
      createdAt: v.number(),
    }),
  ),
  runtimeEvents: v.array(runtimeEventReturn),
  runtimeEventsTruncated: v.boolean(),
  runtimeSessions: v.array(runtimeSessionReturn),
  runtimeSessionsTruncated: v.boolean(),
  sandboxExecutions: v.array(sandboxExecutionReturn),
  sandboxExecutionsTruncated: v.boolean(),
  evidenceArtifacts: v.array(evidenceArtifactReturn),
  evidenceArtifactsTruncated: v.boolean(),
  candidatePatchSets: v.array(candidatePatchSetReturn),
  candidatePatchSetsTruncated: v.boolean(),
  verificationRequirements: v.array(verificationRequirementReturn),
  verificationRequirementsTruncated: v.boolean(),
  verificationResults: v.array(verificationResultReturn),
  verificationResultsTruncated: v.boolean(),
  reviewRuns: v.array(reviewRunReturn),
  reviewRunsTruncated: v.boolean(),
  reviewFindings: v.array(reviewFindingReturn),
  reviewFindingsTruncated: v.boolean(),
  policyDecisions: v.array(policyDecisionReturn),
  policyDecisionsTruncated: v.boolean(),
  humanDecisions: v.array(humanDecisionReturn),
  humanDecisionsTruncated: v.boolean(),
  publicationResults: v.array(publicationResultReturn),
  publicationResultsTruncated: v.boolean(),
  provenanceEvents: v.array(provenanceEventReturn),
  provenanceEventsTruncated: v.boolean(),
})

const workflowStartReturn = v.object({
  promptRequest: v.object({
    id: v.string(),
    workspaceId: v.string(),
    actorId: v.string(),
    traceId: v.string(),
    source: v.union(v.literal('dev'), v.literal('app'), v.literal('external')),
    prompt: v.string(),
    externalRef: v.optional(externalWorkflowRefArg),
    status: v.literal('created'),
    createdAt: v.number(),
  }),
  workflowRun: v.object({
    id: v.string(),
    promptRequestId: v.string(),
    workspaceId: v.string(),
    traceId: v.string(),
    status: v.union(
      v.literal('queued'),
      v.literal('running'),
      v.literal('reviewed'),
      v.literal('failed'),
    ),
    modelVersion: v.optional(v.literal('v1')),
    parentWorkflowRunId: v.optional(v.id('workflowRuns')),
    rootWorkflowRunId: v.optional(v.id('workflowRuns')),
    attemptNumber: v.optional(v.number()),
    trigger: v.optional(v.union(v.literal('intake'), v.literal('rerun'))),
    candidateIdentityVersion: v.optional(v.literal('incoming-pr-v1')),
    sourceBaseSha: v.optional(v.string()),
    sourceCommitSha: v.optional(v.string()),
    trustState: v.optional(
      v.union(
        v.literal('queued'),
        v.literal('running'),
        v.literal('no-sandbox-run'),
        v.literal('sandbox-failed'),
        v.literal('needs-review'),
        v.literal('approved'),
        v.literal('rejected'),
        v.literal('changes-requested'),
      ),
    ),
    updatedAt: v.optional(v.number()),
    createdAt: v.number(),
  }),
})

const decisionPublicationReplayFixtureReturn = v.object({
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

async function createWorkflowStartRecord(
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

async function workflowStartFromIds(
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

async function existingExternalWorkflowRef(
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

async function latestPullRequestLineage(
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

function isGitCommitSha(value: string) {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value)
}

function requireIncomingPullRequestIdentity(externalRef: {
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
  const requiredStrings = [
    externalRef.repositoryExternalId,
    externalRef.repositoryOwner,
    externalRef.repositoryName,
    externalRef.repositoryFullName,
    externalRef.issueExternalId,
    externalRef.pullRequestExternalId,
  ]
  if (
    externalRef.provider !== 'github' ||
    externalRef.repositoryProvider !== 'github' ||
    !['github.pull_request.opened', 'github.pull_request.synchronize'].includes(
      externalRef.eventKind,
    ) ||
    requiredStrings.some(
      (value) => value === undefined || value.trim().length === 0,
    ) ||
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
}

function requireSystemIngestionSecret(secret: string) {
  const expected = process.env.PATCHPLANE_SYSTEM_INGESTION_SECRET

  if (expected === undefined || expected.length === 0 || secret !== expected) {
    throw new ConvexError('System ingestion secret required')
  }
}

async function requireWorkflowRun(
  ctx: QueryCtx | MutationCtx,
  workflowRunId: Id<'workflowRuns'>,
) {
  const workflowRun = await ctx.db.get('workflowRuns', workflowRunId)
  if (workflowRun === null) {
    throw new ConvexError('Workflow run not found')
  }
  return workflowRun
}

async function isLatestWorkflowAttempt(
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

async function requireReviewRunForWorkflow(
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

async function requireEvidenceArtifactForWorkflow(
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

async function insertProvenanceEvent(
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

export const create = mutation({
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

export const createFromExternalIntake = mutation({
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
      pullRequestBaseSha: args.externalRef.pullRequestBaseSha!.toLowerCase(),
      pullRequestHeadSha: args.externalRef.pullRequestHeadSha!.toLowerCase(),
      ...(args.externalRef.pullRequestPreviousHeadSha === undefined
        ? {}
        : {
            pullRequestPreviousHeadSha:
              args.externalRef.pullRequestPreviousHeadSha.toLowerCase(),
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

export const createRerun = mutation({
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

export const getWorkflowExecutionFixture = query({
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

export const claimWorkflowExecution = mutation({
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

export const recordRuntimeEvents = mutation({
  args: {
    systemSecret: v.string(),
    events: v.array(
      v.object({
        workflowRunId: v.id('workflowRuns'),
        provider: v.string(),
        type: v.string(),
        occurredAt: v.number(),
        summary: v.optional(v.string()),
        payloadJson: v.optional(v.string()),
        idempotencyKey: v.optional(v.string()),
        sourceSessionId: v.optional(v.string()),
        sourceCommandId: v.optional(v.string()),
        sourceStream: v.optional(
          v.union(v.literal('stdout'), v.literal('stderr')),
        ),
        sourceLine: v.optional(v.number()),
        sourceOffset: v.optional(v.number()),
      }),
    ),
  },
  returns: v.array(runtimeEventReturn),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const rows = []

    for (const event of args.events) {
      const workflowRun = await ctx.db.get('workflowRuns', event.workflowRunId)
      if (workflowRun === null) {
        throw new ConvexError('Workflow run not found')
      }

      if (event.idempotencyKey !== undefined) {
        const existing = await ctx.db
          .query('runtimeEvents')
          .withIndex('by_workflow_event_key', (q) =>
            q
              .eq('workflowRunId', event.workflowRunId)
              .eq('idempotencyKey', event.idempotencyKey),
          )
          .unique()
        if (existing !== null) {
          rows.push({
            id: existing['_id'],
            workflowRunId: existing.workflowRunId,
            provider: existing.provider,
            type: existing.type,
            occurredAt: existing.occurredAt,
            ...(existing.summary === undefined
              ? {}
              : { summary: existing.summary }),
            ...(existing.payloadJson === undefined
              ? {}
              : { payloadJson: existing.payloadJson }),
            ...(existing.idempotencyKey === undefined
              ? {}
              : { idempotencyKey: existing.idempotencyKey }),
            ...(existing.sourceSessionId === undefined
              ? {}
              : { sourceSessionId: existing.sourceSessionId }),
            ...(existing.sourceCommandId === undefined
              ? {}
              : { sourceCommandId: existing.sourceCommandId }),
            ...(existing.sourceStream === undefined
              ? {}
              : { sourceStream: existing.sourceStream }),
            ...(existing.sourceLine === undefined
              ? {}
              : { sourceLine: existing.sourceLine }),
            ...(existing.sourceOffset === undefined
              ? {}
              : { sourceOffset: existing.sourceOffset }),
          })
          continue
        }
      }

      const id = await ctx.db.insert('runtimeEvents', {
        ...event,
        createdAt: Date.now(),
      })
      await insertProvenanceEvent(ctx, {
        workflowRunId: event.workflowRunId,
        traceId: workflowRun.traceId ?? 'legacy',
        type: 'runtime-event',
        operation: event.type,
        pluginName: event.provider,
        status: 'succeeded',
        startedAt: event.occurredAt,
        completedAt: event.occurredAt,
        summary: event.summary,
        artifactRefs: [String(id)],
        idempotencyKey:
          event.idempotencyKey === undefined
            ? `${String(id)}:runtime-event`
            : `${event.idempotencyKey}:provenance`,
      })
      rows.push({ id, ...event })
    }

    return rows
  },
})

export const recordRuntimeSessionStarted = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    provider: v.string(),
    sandboxId: v.string(),
    sessionId: v.string(),
    commandId: v.string(),
    startedAt: v.number(),
  },
  returns: runtimeSessionReturn,
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const workflowRun = await ctx.db.get('workflowRuns', args.workflowRunId)
    if (workflowRun === null) {
      throw new ConvexError('Workflow run not found')
    }

    const now = Date.now()
    const id = await ctx.db.insert('runtimeSessions', {
      workflowRunId: args.workflowRunId,
      provider: args.provider,
      sandboxId: args.sandboxId,
      sessionId: args.sessionId,
      commandId: args.commandId,
      status: 'running' as const,
      startedAt: args.startedAt,
      updatedAt: now,
      createdAt: now,
    })

    if (workflowRun.status === 'queued') {
      await ctx.db.patch('workflowRuns', args.workflowRunId, {
        status: 'running',
      })
    }

    await insertProvenanceEvent(ctx, {
      workflowRunId: args.workflowRunId,
      traceId: workflowRun.traceId ?? 'legacy',
      type: 'runtime-session',
      operation: 'runtimeSession.started',
      pluginName: args.provider,
      status: 'started',
      startedAt: args.startedAt,
      summary: `Runtime session ${args.sessionId} started in sandbox ${args.sandboxId}.`,
      artifactRefs: [String(id)],
      idempotencyKey: `${args.sessionId}:${args.commandId}:started`,
    })

    return {
      id,
      workflowRunId: args.workflowRunId,
      provider: args.provider,
      sandboxId: args.sandboxId,
      sessionId: args.sessionId,
      commandId: args.commandId,
      status: 'running' as const,
      startedAt: args.startedAt,
      updatedAt: now,
    }
  },
})

export const markRuntimeSessionStatus = mutation({
  args: {
    systemSecret: v.string(),
    runtimeSessionId: v.id('runtimeSessions'),
    status: runtimeSessionStatusArg,
    completedAt: v.optional(v.number()),
  },
  returns: runtimeSessionReturn,
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const runtimeSession = await ctx.db.get(
      'runtimeSessions',
      args.runtimeSessionId,
    )
    if (runtimeSession === null) {
      throw new ConvexError('Runtime session not found')
    }

    const updatedAt = Date.now()
    const workflowRun = await requireWorkflowRun(
      ctx,
      runtimeSession.workflowRunId,
    )
    await ctx.db.patch('runtimeSessions', args.runtimeSessionId, {
      status: args.status,
      updatedAt,
      ...(args.completedAt === undefined
        ? {}
        : { completedAt: args.completedAt }),
    })

    await insertProvenanceEvent(ctx, {
      workflowRunId: runtimeSession.workflowRunId,
      traceId: workflowRun.traceId ?? 'legacy',
      type: 'runtime-session',
      operation: 'runtimeSession.status',
      pluginName: runtimeSession.provider,
      status:
        args.status === 'completed'
          ? 'succeeded'
          : args.status === 'running'
            ? 'started'
            : args.status === 'cancelled'
              ? 'blocked'
              : 'failed',
      startedAt: updatedAt,
      completedAt: args.completedAt ?? updatedAt,
      summary: `Runtime session ${runtimeSession.sessionId} marked ${args.status}.`,
      artifactRefs: [String(args.runtimeSessionId)],
      idempotencyKey: `${String(args.runtimeSessionId)}:${args.status}:${args.completedAt ?? updatedAt}`,
    })

    return {
      id: args.runtimeSessionId,
      workflowRunId: runtimeSession.workflowRunId,
      provider: runtimeSession.provider,
      sandboxId: runtimeSession.sandboxId,
      sessionId: runtimeSession.sessionId,
      commandId: runtimeSession.commandId,
      status: args.status,
      startedAt: runtimeSession.startedAt,
      updatedAt,
      ...(args.completedAt === undefined
        ? runtimeSession.completedAt === undefined
          ? {}
          : { completedAt: runtimeSession.completedAt }
        : { completedAt: args.completedAt }),
    }
  },
})

export const getActiveRuntimeSession = query({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
  },
  returns: v.union(runtimeSessionReturn, v.null()),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const sessions = await ctx.db
      .query('runtimeSessions')
      .withIndex('by_workflow_run', (q) =>
        q.eq('workflowRunId', args.workflowRunId),
      )
      .collect()

    const active = sortedByNumber(
      sessions.filter(
        (session) =>
          session.status === 'starting' || session.status === 'running',
      ),
      (session) => session.updatedAt,
    ).at(-1)

    if (active === undefined) return null
    return {
      id: active['_id'],
      workflowRunId: active.workflowRunId,
      provider: active.provider,
      sandboxId: active.sandboxId,
      sessionId: active.sessionId,
      commandId: active.commandId,
      status: active.status,
      startedAt: active.startedAt,
      updatedAt: active.updatedAt,
      ...(active.completedAt === undefined
        ? {}
        : { completedAt: active.completedAt }),
    }
  },
})

export const getEvidenceArtifact = query({
  args: {
    artifactId: v.id('evidenceArtifacts'),
    workflowRunId: v.optional(v.id('workflowRuns')),
    systemSecret: v.optional(v.string()),
  },
  returns: v.union(evidenceArtifactReturn, v.null()),
  handler: async (ctx, args) => {
    const artifact = await ctx.db.get('evidenceArtifacts', args.artifactId)
    if (artifact === null) return null

    if (
      args.workflowRunId !== undefined &&
      artifact.workflowRunId !== args.workflowRunId
    ) {
      return null
    }

    const workflowRun = await ctx.db.get('workflowRuns', artifact.workflowRunId)
    if (workflowRun === null) {
      throw new ConvexError('Workflow run not found')
    }

    if (args.systemSecret !== undefined) {
      requireSystemIngestionSecret(args.systemSecret)
    } else {
      const identity = await requireWorkOSIdentity(ctx)
      requireWorkOSWorkspace(identity, workflowRun.workspaceId)
      await requireMembershipPermission(
        ctx,
        identity,
        workflowRun.workspaceId,
        'workspace:view',
      )
    }

    return {
      id: artifact['_id'],
      workflowRunId: artifact.workflowRunId,
      ...(artifact.producer === undefined
        ? {}
        : { producer: artifact.producer }),
      ...(artifact.subjectDigest === undefined
        ? {}
        : { subjectDigest: artifact.subjectDigest }),
      ...(artifact.traceId === undefined ? {} : { traceId: artifact.traceId }),
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
    }
  },
})

export const recordEvidenceArtifact = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    producer: v.optional(v.string()),
    subjectDigest: v.optional(v.string()),
    traceId: v.optional(v.string()),
    kind: evidenceArtifactKindArg,
    label: v.optional(v.string()),
    storageProvider: v.literal('cloudflare-r2'),
    storageKey: v.string(),
    contentType: v.string(),
    sizeBytes: v.number(),
    sha256: v.string(),
    retentionPolicy: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  },
  returns: evidenceArtifactReturn,
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)

    const workflowRun = await ctx.db.get('workflowRuns', args.workflowRunId)
    if (workflowRun === null) {
      throw new ConvexError('Workflow run not found')
    }

    const createdAt = args.createdAt ?? Date.now()
    const artifact = {
      workflowRunId: args.workflowRunId,
      ...(args.producer === undefined ? {} : { producer: args.producer }),
      ...(args.subjectDigest === undefined
        ? {}
        : { subjectDigest: args.subjectDigest }),
      ...(args.traceId === undefined ? {} : { traceId: args.traceId }),
      kind: args.kind,
      ...(args.label === undefined ? {} : { label: args.label }),
      storageProvider: args.storageProvider,
      storageKey: args.storageKey,
      contentType: args.contentType,
      sizeBytes: args.sizeBytes,
      sha256: args.sha256,
      ...(args.retentionPolicy === undefined
        ? {}
        : { retentionPolicy: args.retentionPolicy }),
      createdAt,
    }
    const existingArtifact = await ctx.db
      .query('evidenceArtifacts')
      .withIndex('by_storage_key', (q) =>
        q
          .eq('storageProvider', args.storageProvider)
          .eq('storageKey', args.storageKey),
      )
      .unique()
    if (existingArtifact !== null) {
      if (
        existingArtifact.workflowRunId !== args.workflowRunId ||
        existingArtifact.producer !== args.producer ||
        existingArtifact.subjectDigest !== args.subjectDigest ||
        existingArtifact.traceId !== args.traceId ||
        existingArtifact.kind !== args.kind ||
        existingArtifact.label !== args.label ||
        existingArtifact.contentType !== args.contentType ||
        existingArtifact.sizeBytes !== args.sizeBytes ||
        existingArtifact.sha256 !== args.sha256 ||
        existingArtifact.retentionPolicy !== args.retentionPolicy
      ) {
        throw new ConvexError('Evidence artifact storage key conflict')
      }
      return {
        id: existingArtifact._id,
        workflowRunId: existingArtifact.workflowRunId,
        ...(existingArtifact.producer === undefined
          ? {}
          : { producer: existingArtifact.producer }),
        ...(existingArtifact.subjectDigest === undefined
          ? {}
          : { subjectDigest: existingArtifact.subjectDigest }),
        ...(existingArtifact.traceId === undefined
          ? {}
          : { traceId: existingArtifact.traceId }),
        kind: existingArtifact.kind,
        ...(existingArtifact.label === undefined
          ? {}
          : { label: existingArtifact.label }),
        storageProvider: existingArtifact.storageProvider,
        storageKey: existingArtifact.storageKey,
        contentType: existingArtifact.contentType,
        sizeBytes: existingArtifact.sizeBytes,
        sha256: existingArtifact.sha256,
        ...(existingArtifact.retentionPolicy === undefined
          ? {}
          : { retentionPolicy: existingArtifact.retentionPolicy }),
        createdAt: existingArtifact.createdAt,
      }
    }
    const id = await ctx.db.insert('evidenceArtifacts', artifact)
    await insertProvenanceEvent(ctx, {
      workflowRunId: args.workflowRunId,
      traceId: args.traceId ?? workflowRun.traceId ?? 'legacy',
      type: 'evidence-artifact',
      operation: `evidenceArtifact.${args.kind}`,
      status: 'succeeded',
      startedAt: createdAt,
      completedAt: createdAt,
      summary: args.label ?? `Captured ${args.kind} artifact.`,
      artifactRefs: [String(id)],
      idempotencyKey: `${String(id)}:evidence-artifact`,
    })

    return { id, ...artifact }
  },
})

export const getCandidatePatchSetForWorkflow = query({
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

export const claimCandidateFreeze = mutation({
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

export const releaseCandidateFreeze = mutation({
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

export const failCandidateFreeze = mutation({
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

export const claimIncomingDispatch = mutation({
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

export const startIncomingDispatch = mutation({
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

export const expireStartedIncomingDispatch = internalMutation({
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
    await ctx.db.patch('workflowRuns', args.workflowRunId, { status: 'failed' })
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

export const validateIncomingDispatch = mutation({
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

export const recordCandidatePatchSet = mutation({
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
          args.baseSha.toLowerCase() !==
            workflowRun.sourceCommitSha.toLowerCase()
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

function normalizeCanonicalJson(candidate: unknown): unknown {
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

function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeCanonicalJson(value))
}

async function verificationPlanDigest(input: {
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

export const recordVerificationPlan = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    version: v.literal('verification-plan-v1'),
    sources: v.array(verificationPlanSourceArg),
    requirements: v.array(verificationPlanRequirementArg),
    digest: v.string(),
    createdAt: v.number(),
  },
  returns: verificationPlanReturn,
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const workflowRun = await requireWorkflowRun(ctx, args.workflowRunId)
    const promptRequest = await ctx.db.get(
      'promptRequests',
      workflowRun.promptRequestId,
    )
    const sourceKinds = new Set(args.sources.map((source) => source.kind))
    const requirementKeys = new Set(
      args.requirements.map((requirement) => requirement.key),
    )
    const computedDigest = await verificationPlanDigest(args)
    if (
      workflowRun.modelVersion !== 'v1' ||
      args.sources.length === 0 ||
      args.sources.length > 3 ||
      sourceKinds.size !== args.sources.length ||
      args.sources[0]?.kind !== 'deployment-system' ||
      args.sources.some((source, index) => {
        const expectedOrder = [
          'deployment-system',
          'workspace-policy',
          'base-repository-policy',
        ] as const
        return (
          expectedOrder.indexOf(source.kind) < index ||
          source.revision.trim().length === 0 ||
          source.revision !== source.revision.trim() ||
          source.revision.length > 256 ||
          (source.workspaceId?.length ?? 0) > 256 ||
          (source.repositoryFullName?.length ?? 0) > 253 ||
          (source.kind === 'deployment-system' &&
            (source.workspaceId !== undefined ||
              source.repositoryFullName !== undefined ||
              source.baseSha !== undefined)) ||
          (source.kind === 'workspace-policy' &&
            (source.workspaceId !== workflowRun.workspaceId ||
              source.repositoryFullName !== undefined ||
              source.baseSha !== undefined)) ||
          (source.kind === 'base-repository-policy' &&
            (source.workspaceId !== undefined ||
              source.repositoryFullName === undefined ||
              source.repositoryFullName !==
                promptRequest?.externalRef?.repositoryFullName ||
              source.baseSha === undefined ||
              !/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(source.baseSha) ||
              source.baseSha !== workflowRun.sourceBaseSha))
        )
      }) ||
      new TextEncoder().encode(
        canonicalJson({
          version: args.version,
          sources: args.sources,
          requirements: args.requirements,
        }),
      ).byteLength > 65_536 ||
      !Number.isSafeInteger(args.createdAt) ||
      args.createdAt < 0 ||
      args.requirements.length > 16 ||
      requirementKeys.size !== args.requirements.length ||
      args.requirements.some(
        (requirement) =>
          requirement.key.trim().length === 0 ||
          requirement.key !== requirement.key.trim() ||
          requirement.key.length > 128 ||
          requirement.label.trim().length === 0 ||
          requirement.label !== requirement.label.trim() ||
          requirement.label.length > 256 ||
          (requirement.command !== undefined &&
            requirement.command.length === 0) ||
          (requirement.command?.length ?? 0) > 2_000 ||
          (requirement.timeoutSeconds !== undefined &&
            (!Number.isSafeInteger(requirement.timeoutSeconds) ||
              requirement.timeoutSeconds < 0)) ||
          (requirement.timeoutSeconds ?? 0) > 1_800 ||
          (requirement.architecture !== undefined &&
            requirement.architecture.length === 0) ||
          (requirement.architecture?.length ?? 0) > 128 ||
          new Set(requirement.requiredArtifactKinds).size !==
            requirement.requiredArtifactKinds.length ||
          requirement.requiredArtifactKinds.length > 8,
      ) ||
      args.digest !== computedDigest
    ) {
      throw new ConvexError(
        'V1 verification plan must be bounded, trusted, and persisted before candidate freeze',
      )
    }
    const existing = await ctx.db
      .query('verificationPlans')
      .withIndex('by_workflow_run', (q) =>
        q.eq('workflowRunId', args.workflowRunId),
      )
      .first()
    if (existing !== null) {
      if (
        existing.digest !== args.digest ||
        canonicalJson(existing.sources) !== canonicalJson(args.sources) ||
        canonicalJson(existing.requirements) !==
          canonicalJson(args.requirements)
      ) {
        throw new ConvexError('Verification plan conflict for workflow attempt')
      }
      return {
        id: existing._id,
        workflowRunId: existing.workflowRunId,
        version: existing.version,
        sources: existing.sources,
        requirements: existing.requirements,
        digest: existing.digest,
        createdAt: existing.createdAt,
      }
    }
    if (
      !(await isLatestWorkflowAttempt(ctx, workflowRun)) ||
      (workflowRun.candidateIdentityVersion === 'incoming-pr-v1' &&
        (workflowRun.status !== 'queued' ||
          workflowRun.candidateFreezeClaimedAt !== undefined)) ||
      (workflowRun.candidateIdentityVersion !== 'incoming-pr-v1' &&
        workflowRun.status !== 'queued' &&
        workflowRun.status !== 'running')
    ) {
      throw new ConvexError(
        'Verification plan first write is not allowed in the current attempt state',
      )
    }
    const id = await ctx.db.insert('verificationPlans', {
      workflowRunId: args.workflowRunId,
      version: args.version,
      sources: args.sources,
      requirements: args.requirements,
      digest: args.digest,
      createdAt: args.createdAt,
    })
    return {
      id,
      workflowRunId: args.workflowRunId,
      version: args.version,
      sources: args.sources,
      requirements: args.requirements,
      digest: args.digest,
      createdAt: args.createdAt,
    }
  },
})

export const recordVerificationRequirement = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    verificationPlanId: v.optional(v.id('verificationPlans')),
    key: v.string(),
    label: v.string(),
    kind: verificationRequirementKindArg,
    required: v.boolean(),
    command: v.optional(v.string()),
    platform: v.optional(verificationPlatformArg),
    architecture: v.optional(v.string()),
    timeoutSeconds: v.optional(v.number()),
    requiredArtifactKinds: v.array(evidenceArtifactKindArg),
    source: verificationRequirementSourceArg,
    createdAt: v.number(),
  },
  returns: verificationRequirementReturn,
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const workflowRun = await requireWorkflowRun(ctx, args.workflowRunId)
    const key = args.key.trim()
    const label = args.label.trim()
    if (key.length === 0 || label.length === 0) {
      throw new ConvexError(
        'Verification requirement key and label are required',
      )
    }
    if (workflowRun.candidateIdentityVersion === 'incoming-pr-v1') {
      const plan =
        args.verificationPlanId === undefined
          ? null
          : await ctx.db.get('verificationPlans', args.verificationPlanId)
      const planned = plan?.requirements.find(
        (requirement) => requirement.key === key,
      )
      if (
        plan === null ||
        plan.workflowRunId !== args.workflowRunId ||
        planned === undefined ||
        planned.label !== label ||
        planned.kind !== args.kind ||
        planned.required !== args.required ||
        planned.command !== args.command ||
        planned.platform !== args.platform ||
        planned.architecture !== args.architecture ||
        planned.timeoutSeconds !== args.timeoutSeconds ||
        JSON.stringify(planned.requiredArtifactKinds) !==
          JSON.stringify(args.requiredArtifactKinds)
      ) {
        throw new ConvexError(
          'Incoming PR requirement must exactly match its trusted verification plan',
        )
      }
    }
    if (args.requiredArtifactKinds.length > 16) {
      throw new ConvexError(
        'Verification requirement artifact kinds exceed limit',
      )
    }

    const existing = await ctx.db
      .query('verificationRequirements')
      .withIndex('by_workflow_run_and_key', (q) =>
        q.eq('workflowRunId', args.workflowRunId).eq('key', key),
      )
      .unique()
    if (existing !== null) {
      if (
        existing.verificationPlanId !== args.verificationPlanId ||
        existing.label !== label ||
        existing.kind !== args.kind ||
        existing.required !== args.required ||
        existing.command !== args.command ||
        existing.platform !== args.platform ||
        existing.architecture !== args.architecture ||
        existing.timeoutSeconds !== args.timeoutSeconds ||
        existing.source !== args.source ||
        JSON.stringify(existing.requiredArtifactKinds) !==
          JSON.stringify(args.requiredArtifactKinds)
      ) {
        throw new ConvexError('Verification requirement key conflict')
      }
      return {
        id: existing._id,
        workflowRunId: existing.workflowRunId,
        ...(existing.verificationPlanId === undefined
          ? {}
          : { verificationPlanId: existing.verificationPlanId }),
        key: existing.key,
        label: existing.label,
        kind: existing.kind,
        required: existing.required,
        ...(existing.command === undefined
          ? {}
          : { command: existing.command }),
        ...(existing.platform === undefined
          ? {}
          : { platform: existing.platform }),
        ...(existing.architecture === undefined
          ? {}
          : { architecture: existing.architecture }),
        ...(existing.timeoutSeconds === undefined
          ? {}
          : { timeoutSeconds: existing.timeoutSeconds }),
        requiredArtifactKinds: existing.requiredArtifactKinds,
        source: existing.source,
        createdAt: existing.createdAt,
      }
    }

    const requirement = {
      workflowRunId: args.workflowRunId,
      ...(args.verificationPlanId === undefined
        ? {}
        : { verificationPlanId: args.verificationPlanId }),
      key,
      label,
      kind: args.kind,
      required: args.required,
      ...(args.command === undefined ? {} : { command: args.command }),
      ...(args.platform === undefined ? {} : { platform: args.platform }),
      ...(args.architecture === undefined
        ? {}
        : { architecture: args.architecture }),
      ...(args.timeoutSeconds === undefined
        ? {}
        : { timeoutSeconds: args.timeoutSeconds }),
      requiredArtifactKinds: args.requiredArtifactKinds,
      source: args.source,
      createdAt: args.createdAt,
    }
    const id = await ctx.db.insert('verificationRequirements', requirement)
    return { id, ...requirement }
  },
})

function verificationExecutionGroupValue(
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

function verificationResultValue(result: Doc<'verificationResults'>) {
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

function sandboxExecutionValue(execution: Doc<'sandboxExecutions'>) {
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

export const startIncomingVerificationPlan = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    verificationPlanId: v.id('verificationPlans'),
    candidatePatchSetId: v.id('candidatePatchSets'),
    incomingDispatchToken: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const [workflowRun, plan, candidate] = await Promise.all([
      requireWorkflowRun(ctx, args.workflowRunId),
      ctx.db.get('verificationPlans', args.verificationPlanId),
      ctx.db.get('candidatePatchSets', args.candidatePatchSetId),
    ])
    const latestAttempt = await isLatestWorkflowAttempt(ctx, workflowRun)
    const established =
      workflowRun.incomingVerificationPlanId === args.verificationPlanId &&
      workflowRun.incomingVerificationDispatchToken ===
        args.incomingDispatchToken &&
      workflowRun.incomingVerificationCandidatePatchSetId ===
        args.candidatePatchSetId &&
      workflowRun.incomingVerificationStartedAt !== undefined
    if (established) {
      return workflowRun.status === 'running' && latestAttempt
    }
    if (
      args.incomingDispatchToken.length < 16 ||
      workflowRun.candidateIdentityVersion !== 'incoming-pr-v1' ||
      workflowRun.status !== 'running' ||
      !latestAttempt ||
      workflowRun.incomingVerificationPlanId !== undefined ||
      workflowRun.incomingDispatchToken !== args.incomingDispatchToken ||
      workflowRun.incomingDispatchCandidatePatchSetId !==
        args.candidatePatchSetId ||
      workflowRun.incomingDispatchClaimedAt === undefined ||
      Date.now() - workflowRun.incomingDispatchClaimedAt >= 300_000 ||
      plan === null ||
      plan.workflowRunId !== args.workflowRunId ||
      candidate === null ||
      candidate.workflowRunId !== args.workflowRunId ||
      candidate.subject?.kind !== 'incoming-pull-request' ||
      candidate.status !== 'captured'
    ) {
      return false
    }
    const startedAt = Date.now()
    await ctx.db.patch('workflowRuns', args.workflowRunId, {
      incomingVerificationPlanId: args.verificationPlanId,
      incomingVerificationDispatchToken: args.incomingDispatchToken,
      incomingVerificationCandidatePatchSetId: args.candidatePatchSetId,
      incomingVerificationStartedAt: startedAt,
    })
    const planRecoveryTimeoutMs = Math.min(
      12 * 60 * 60 * 1_000,
      Math.max(
        incomingDispatchRecoveryTimeoutMs,
        plan.requirements.reduce(
          (total, plannedRequirement) =>
            total + ((plannedRequirement.timeoutSeconds ?? 900) + 900) * 1_000,
          0,
        ),
      ),
    )
    await ctx.scheduler.runAfter(
      planRecoveryTimeoutMs,
      internal.workflowStarts.expireIncomingVerificationDispatch,
      {
        workflowRunId: args.workflowRunId,
        verificationPlanId: args.verificationPlanId,
        dispatchToken: args.incomingDispatchToken,
        candidatePatchSetId: args.candidatePatchSetId,
      },
    )
    return true
  },
})

export const claimVerificationExecutionGroup = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    verificationPlanId: v.id('verificationPlans'),
    requirementId: v.id('verificationRequirements'),
    candidatePatchSetId: v.id('candidatePatchSets'),
    stableKey: v.string(),
    claimToken: v.string(),
    incomingDispatchToken: v.string(),
    provider: v.string(),
    platform: verificationPlatformArg,
    architecture: v.string(),
    commandDigest: v.optional(v.string()),
    timeoutSeconds: v.optional(v.number()),
    claimedAt: v.number(),
  },
  returns: v.union(verificationExecutionGroupReturn, v.null()),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const [workflowRun, plan, requirement, candidate] = await Promise.all([
      requireWorkflowRun(ctx, args.workflowRunId),
      ctx.db.get('verificationPlans', args.verificationPlanId),
      ctx.db.get('verificationRequirements', args.requirementId),
      ctx.db.get('candidatePatchSets', args.candidatePatchSetId),
    ])
    const now = Date.now()
    const expectedStableKey = `${String(args.verificationPlanId)}:${String(args.requirementId)}:${String(args.candidatePatchSetId)}`
    if (args.stableKey !== expectedStableKey) {
      throw new ConvexError('Verification execution group identity mismatch')
    }
    const preexisting = await ctx.db
      .query('verificationExecutionGroups')
      .withIndex('by_workflow_stable_key', (q) =>
        q
          .eq('workflowRunId', args.workflowRunId)
          .eq('stableKey', args.stableKey),
      )
      .unique()
    if (
      preexisting !== null &&
      preexisting.status !== 'claimed' &&
      preexisting.status !== 'running'
    ) {
      return null
    }
    const expectedCommandDigest =
      requirement?.command === undefined
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
    const establishedPlanDispatch =
      workflowRun.incomingVerificationPlanId === args.verificationPlanId &&
      workflowRun.incomingVerificationDispatchToken ===
        args.incomingDispatchToken &&
      workflowRun.incomingVerificationCandidatePatchSetId ===
        args.candidatePatchSetId &&
      workflowRun.incomingVerificationStartedAt !== undefined
    if (
      args.claimToken.length < 16 ||
      args.incomingDispatchToken.length < 16 ||
      !isEpochMillis(args.claimedAt) ||
      args.stableKey.length === 0 ||
      args.stableKey.length > 256 ||
      args.provider.length === 0 ||
      args.architecture.length === 0 ||
      args.commandDigest !== expectedCommandDigest ||
      args.timeoutSeconds !== (requirement?.timeoutSeconds ?? 900) ||
      !establishedPlanDispatch ||
      workflowRun.candidateIdentityVersion !== 'incoming-pr-v1' ||
      workflowRun.status !== 'running' ||
      !(await isLatestWorkflowAttempt(ctx, workflowRun)) ||
      plan === null ||
      plan.workflowRunId !== args.workflowRunId ||
      requirement === null ||
      requirement.workflowRunId !== args.workflowRunId ||
      requirement.verificationPlanId !== args.verificationPlanId ||
      candidate === null ||
      candidate.workflowRunId !== args.workflowRunId ||
      candidate.subject?.kind !== 'incoming-pull-request' ||
      candidate.status !== 'captured' ||
      candidate.candidateDigest === undefined ||
      (requirement.platform ?? 'linux') !== args.platform ||
      (requirement.architecture !== undefined &&
        requirement.architecture !== args.architecture)
    ) {
      throw new ConvexError('Invalid verification execution group claim')
    }
    const existing = preexisting
    if (existing !== null) {
      const retryable =
        existing.status === 'claimed' &&
        existing.startedAt === undefined &&
        now - existing.claimedAt >= 300_000
      if (!retryable) return null
      await ctx.db.patch('verificationExecutionGroups', existing._id, {
        claimToken: args.claimToken,
        claimedAt: now,
      })
      return verificationExecutionGroupValue({
        ...existing,
        claimToken: args.claimToken,
        claimedAt: now,
      })
    }
    const id = await ctx.db.insert('verificationExecutionGroups', {
      workflowRunId: args.workflowRunId,
      verificationPlanId: args.verificationPlanId,
      requirementId: args.requirementId,
      candidatePatchSetId: args.candidatePatchSetId,
      stableKey: args.stableKey,
      claimToken: args.claimToken,
      provider: args.provider,
      platform: args.platform,
      architecture: args.architecture,
      ...(args.commandDigest === undefined
        ? {}
        : { commandDigest: args.commandDigest }),
      ...(args.timeoutSeconds === undefined
        ? {}
        : { timeoutSeconds: args.timeoutSeconds }),
      sharedState: false,
      status: 'claimed',
      claimedAt: now,
    })
    const inserted = await ctx.db.get('verificationExecutionGroups', id)
    if (inserted === null) throw new ConvexError('Execution group disappeared')
    return verificationExecutionGroupValue(inserted)
  },
})

export const expireIncomingVerificationDispatch = internalMutation({
  args: {
    workflowRunId: v.id('workflowRuns'),
    verificationPlanId: v.id('verificationPlans'),
    dispatchToken: v.string(),
    candidatePatchSetId: v.id('candidatePatchSets'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const workflowRun = await ctx.db.get('workflowRuns', args.workflowRunId)
    if (
      workflowRun === null ||
      workflowRun.status !== 'running' ||
      workflowRun.incomingVerificationPlanId !== args.verificationPlanId ||
      workflowRun.incomingVerificationDispatchToken !== args.dispatchToken ||
      workflowRun.incomingVerificationCandidatePatchSetId !==
        args.candidatePatchSetId
    ) {
      return null
    }
    const completedAt = Date.now()
    const [persistedGroups, candidate, requirements] = await Promise.all([
      ctx.db
        .query('verificationExecutionGroups')
        .withIndex('by_workflow_run', (q) =>
          q.eq('workflowRunId', args.workflowRunId),
        )
        .collect(),
      ctx.db.get('candidatePatchSets', args.candidatePatchSetId),
      ctx.db
        .query('verificationRequirements')
        .withIndex('by_workflow_run', (q) =>
          q.eq('workflowRunId', args.workflowRunId),
        )
        .collect(),
    ])
    const groups = [...persistedGroups]
    for (const requirement of requirements.filter(
      (plannedRequirement) =>
        plannedRequirement.verificationPlanId === args.verificationPlanId,
    )) {
      if (groups.some((group) => group.requirementId === requirement._id)) {
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
        workflowRunId: args.workflowRunId,
        verificationPlanId: args.verificationPlanId,
        requirementId: requirement._id,
        candidatePatchSetId: args.candidatePatchSetId,
        stableKey: `${String(args.verificationPlanId)}:${String(requirement._id)}:${String(args.candidatePatchSetId)}`,
        claimToken: `recovery:${String(requirement._id)}`,
        provider: 'daytona',
        platform: requirement.platform ?? 'linux',
        architecture: requirement.architecture ?? 'x86_64',
        ...(commandDigest === undefined ? {} : { commandDigest }),
        timeoutSeconds: requirement.timeoutSeconds ?? 900,
        sharedState: false,
        status: 'claimed',
        claimedAt: workflowRun.incomingVerificationStartedAt ?? completedAt,
      })
      const inserted = await ctx.db.get('verificationExecutionGroups', groupId)
      if (inserted !== null) groups.push(inserted)
    }
    for (const group of groups.filter(
      (candidateGroup) =>
        candidateGroup.verificationPlanId === args.verificationPlanId &&
        candidateGroup.candidatePatchSetId === args.candidatePatchSetId &&
        (candidateGroup.status === 'claimed' ||
          candidateGroup.status === 'running'),
    )) {
      const idempotencyKey = `${String(group._id)}:result`
      const existingResult = await ctx.db
        .query('verificationResults')
        .withIndex('by_workflow_run_and_idempotency_key', (q) =>
          q
            .eq('workflowRunId', args.workflowRunId)
            .eq('idempotencyKey', idempotencyKey),
        )
        .unique()
      const requirement = await ctx.db.get(
        'verificationRequirements',
        group.requirementId,
      )
      await ctx.db.patch('verificationExecutionGroups', group._id, {
        status: 'failed',
        completedAt,
      })
      if (existingResult === null && requirement !== null) {
        await ctx.db.insert('verificationResults', {
          workflowRunId: args.workflowRunId,
          verificationPlanId: args.verificationPlanId,
          executionGroupId: group._id,
          requirementId: group.requirementId,
          candidatePatchSetId: args.candidatePatchSetId,
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
          summary: 'Verification plan exceeded its durable recovery deadline.',
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
    await ctx.db.patch('workflowRuns', args.workflowRunId, { status: 'failed' })
    await insertProvenanceEvent(ctx, {
      workflowRunId: args.workflowRunId,
      traceId: workflowRun.traceId ?? 'legacy',
      type: 'verification-plan-execution',
      operation: 'workflowStarts.expireIncomingVerificationDispatch',
      status: 'failed',
      startedAt: workflowRun.incomingVerificationStartedAt ?? completedAt,
      completedAt,
      summary:
        'Incoming verification plan did not reach durable policy completion before its recovery deadline.',
      artifactRefs: [],
      errorCategory: 'verification-plan-recovery-timeout',
      idempotencyKey: `${String(args.workflowRunId)}:verification-plan-timeout`,
    })
    return null
  },
})

export const startVerificationExecutionGroup = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    executionGroupId: v.id('verificationExecutionGroups'),
    claimToken: v.string(),
    sandboxId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const workflowRun = await requireWorkflowRun(ctx, args.workflowRunId)
    const group = await ctx.db.get(
      'verificationExecutionGroups',
      args.executionGroupId,
    )
    const reusedGroup =
      group === null
        ? null
        : await ctx.db
            .query('verificationExecutionGroups')
            .withIndex('by_provider_sandbox', (q) =>
              q.eq('provider', group.provider).eq('sandboxId', args.sandboxId),
            )
            .first()
    const reusedExecution =
      group === null
        ? null
        : await ctx.db
            .query('sandboxExecutions')
            .withIndex('by_provider_sandbox', (q) =>
              q.eq('provider', group.provider).eq('sandboxId', args.sandboxId),
            )
            .first()
    if (
      !(await isLatestWorkflowAttempt(ctx, workflowRun)) ||
      workflowRun.status !== 'running' ||
      group === null ||
      group.workflowRunId !== args.workflowRunId ||
      group.claimToken !== args.claimToken ||
      group.status !== 'claimed' ||
      group.sandboxId !== undefined ||
      (reusedGroup !== null && reusedGroup._id !== group._id) ||
      reusedExecution !== null ||
      args.sandboxId.length === 0
    ) {
      return false
    }
    await ctx.db.patch('verificationExecutionGroups', group._id, {
      status: 'running',
      sandboxId: args.sandboxId,
      startedAt: Date.now(),
    })
    await ctx.scheduler.runAfter(
      verificationExecutionGroupRecoveryTimeoutMs,
      internal.workflowStarts.expireVerificationExecutionGroup,
      {
        executionGroupId: group._id,
        claimToken: args.claimToken,
        sandboxId: args.sandboxId,
      },
    )
    return true
  },
})

export const recordVerificationExecutionCommand = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    executionGroupId: v.id('verificationExecutionGroups'),
    claimToken: v.string(),
    sandboxId: v.string(),
    providerSessionId: v.string(),
    providerCommandId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const group = await ctx.db.get(
      'verificationExecutionGroups',
      args.executionGroupId,
    )
    if (
      group === null ||
      group.workflowRunId !== args.workflowRunId ||
      group.claimToken !== args.claimToken ||
      group.status !== 'running' ||
      group.sandboxId !== args.sandboxId ||
      args.providerSessionId.length === 0 ||
      args.providerSessionId.length > 256 ||
      args.providerCommandId.length === 0 ||
      args.providerCommandId.length > 256
    ) {
      return false
    }
    if (
      group.providerSessionId !== undefined ||
      group.providerCommandId !== undefined
    ) {
      return (
        group.providerSessionId === args.providerSessionId &&
        group.providerCommandId === args.providerCommandId
      )
    }
    await ctx.db.patch('verificationExecutionGroups', group._id, {
      providerSessionId: args.providerSessionId,
      providerCommandId: args.providerCommandId,
    })
    return true
  },
})

export const expireVerificationExecutionGroup = internalMutation({
  args: {
    executionGroupId: v.id('verificationExecutionGroups'),
    claimToken: v.string(),
    sandboxId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const group = await ctx.db.get(
      'verificationExecutionGroups',
      args.executionGroupId,
    )
    if (
      group === null ||
      group.status !== 'running' ||
      group.claimToken !== args.claimToken ||
      group.sandboxId !== args.sandboxId
    ) {
      return null
    }
    const completedAt = Date.now()
    await ctx.db.patch('verificationExecutionGroups', group._id, {
      status: 'failed',
      completedAt,
    })
    const resultIdempotencyKey = `${String(group._id)}:result`
    const existingResult = await ctx.db
      .query('verificationResults')
      .withIndex('by_workflow_run_and_idempotency_key', (q) =>
        q
          .eq('workflowRunId', group.workflowRunId)
          .eq('idempotencyKey', resultIdempotencyKey),
      )
      .unique()
    const [requirement, candidate] = await Promise.all([
      ctx.db.get('verificationRequirements', group.requirementId),
      ctx.db.get('candidatePatchSets', group.candidatePatchSetId),
    ])
    if (existingResult === null && requirement !== null && candidate !== null) {
      await ctx.db.insert('verificationResults', {
        workflowRunId: group.workflowRunId,
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
        summary:
          'Started verification group exceeded its durable recovery deadline.',
        artifactIds: [],
        producedArtifactKinds: [],
        stdoutCaptureStatus: 'failed',
        stderrCaptureStatus: 'failed',
        cleanupStatus: 'failed',
        ...(candidate.candidateDigest === undefined
          ? {}
          : { candidateDigestBefore: candidate.candidateDigest }),
        startedAt: group.startedAt ?? group.claimedAt,
        completedAt,
        idempotencyKey: resultIdempotencyKey,
      })
    }
    const workflowRun = await ctx.db.get('workflowRuns', group.workflowRunId)
    await insertProvenanceEvent(ctx, {
      workflowRunId: group.workflowRunId,
      traceId: workflowRun?.traceId ?? 'legacy',
      type: 'verification-execution-group',
      operation: 'workflowStarts.expireVerificationExecutionGroup',
      status: 'failed',
      startedAt: group.startedAt ?? group.claimedAt,
      completedAt,
      summary:
        'Started verification execution group did not persist a terminal result before its recovery deadline.',
      artifactRefs: [],
      errorCategory: 'execution-group-recovery-timeout',
      idempotencyKey: `${String(group._id)}:recovery-timeout`,
    })
    return null
  },
})

export const failVerificationExecutionGroup = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    executionGroupId: v.id('verificationExecutionGroups'),
    claimToken: v.string(),
    status: v.union(
      v.literal('failed'),
      v.literal('blocked'),
      v.literal('cancelled'),
    ),
    completedAt: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const group = await ctx.db.get(
      'verificationExecutionGroups',
      args.executionGroupId,
    )
    if (
      group === null ||
      group.workflowRunId !== args.workflowRunId ||
      group.claimToken !== args.claimToken ||
      (group.status !== 'claimed' && group.status !== 'running') ||
      !isEpochMillis(args.completedAt) ||
      args.completedAt < group.claimedAt
    ) {
      return false
    }
    await ctx.db.patch('verificationExecutionGroups', group._id, {
      status: args.status,
      completedAt: args.completedAt,
    })
    return true
  },
})

export const getVerificationExecutionState = query({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    verificationPlanId: v.id('verificationPlans'),
    candidatePatchSetId: v.id('candidatePatchSets'),
  },
  returns: v.object({
    groups: v.array(verificationExecutionGroupReturn),
    results: v.array(verificationResultReturn),
    sandboxExecutions: v.array(sandboxExecutionReturn),
  }),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const groups = await ctx.db
      .query('verificationExecutionGroups')
      .withIndex('by_workflow_run', (q) =>
        q.eq('workflowRunId', args.workflowRunId),
      )
      .collect()
    const selectedGroups = groups.filter(
      (group) =>
        group.verificationPlanId === args.verificationPlanId &&
        group.candidatePatchSetId === args.candidatePatchSetId,
    )
    const groupIds = new Set(selectedGroups.map((group) => group._id))
    const [results, executions] = await Promise.all([
      ctx.db
        .query('verificationResults')
        .withIndex('by_workflow_run', (q) =>
          q.eq('workflowRunId', args.workflowRunId),
        )
        .collect(),
      ctx.db
        .query('sandboxExecutions')
        .withIndex('by_workflow_run', (q) =>
          q.eq('workflowRunId', args.workflowRunId),
        )
        .collect(),
    ])
    return {
      groups: selectedGroups.map(verificationExecutionGroupValue),
      results: results
        .filter(
          (result) =>
            result.verificationPlanId === args.verificationPlanId &&
            result.candidatePatchSetId === args.candidatePatchSetId &&
            result.executionGroupId !== undefined &&
            groupIds.has(result.executionGroupId),
        )
        .map(verificationResultValue),
      sandboxExecutions: executions
        .filter(
          (execution) =>
            execution.executionGroupId !== undefined &&
            groupIds.has(execution.executionGroupId),
        )
        .map(sandboxExecutionValue),
    }
  },
})

export const recordVerificationResult = mutation({
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
      args.command === undefined
        ? undefined
        : `sha256:${Array.from(
            new Uint8Array(
              await crypto.subtle.digest(
                'SHA-256',
                new TextEncoder().encode(args.command),
              ),
            ),
            (byte) => byte.toString(16).padStart(2, '0'),
          ).join('')}`
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

export const recordReviewRun = mutation({
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

export const recordReviewFinding = mutation({
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

export const recordPolicyDecision = mutation({
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

export const recordPublicationResult = mutation({
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

export const recordProvenanceEvent = mutation({
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

export const markWorkflowExecutionFailed = mutation({
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
    await ctx.db.patch('workflowRuns', args.workflowRunId, { status: 'failed' })
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

export const recordSandboxExecution = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    incomingDispatchToken: v.optional(v.string()),
    executionGroupId: v.optional(v.id('verificationExecutionGroups')),
    executionGroupClaimToken: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    provider: v.string(),
    sandboxId: v.string(),
    providerSessionId: v.optional(v.string()),
    providerCommandId: v.optional(v.string()),
    command: v.string(),
    status: v.union(v.literal('succeeded'), v.literal('failed')),
    exitCode: v.optional(v.number()),
    stdout: v.string(),
    stderr: v.optional(v.string()),
    policy: v.optional(sandboxPolicyArg),
    startedAt: v.number(),
    completedAt: v.number(),
  },
  returns: sandboxExecutionReturn,
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)

    const workflowRun = await ctx.db.get('workflowRuns', args.workflowRunId)
    if (workflowRun === null) {
      throw new ConvexError('Workflow run not found')
    }
    if (
      !isValidProviderProcessIdentityPair(
        args.providerSessionId,
        args.providerCommandId,
      ) ||
      !isEpochMillis(args.startedAt) ||
      !isEpochMillis(args.completedAt) ||
      args.completedAt < args.startedAt ||
      args.completedAt > Date.now() + 60_000
    ) {
      throw new ConvexError('Invalid sandbox execution timing')
    }
    if (workflowRun.modelVersion === 'v1') {
      const executionGroup =
        args.executionGroupId === undefined
          ? null
          : await ctx.db.get(
              'verificationExecutionGroups',
              args.executionGroupId,
            )
      if (
        executionGroup?.sandboxExecutionId !== undefined &&
        args.idempotencyKey !== undefined
      ) {
        const existing = await ctx.db.get(
          'sandboxExecutions',
          executionGroup.sandboxExecutionId,
        )
        if (
          existing !== null &&
          existing.idempotencyKey === args.idempotencyKey &&
          existing.workflowRunId === args.workflowRunId &&
          existing.executionGroupId === args.executionGroupId &&
          existing.provider === args.provider &&
          existing.sandboxId === args.sandboxId &&
          existing.providerSessionId === args.providerSessionId &&
          existing.providerCommandId === args.providerCommandId &&
          existing.command === args.command &&
          existing.status === args.status &&
          existing.exitCode === args.exitCode &&
          existing.stdout === args.stdout &&
          existing.stderr === args.stderr &&
          JSON.stringify(existing.policy) === JSON.stringify(args.policy) &&
          existing.startedAt === args.startedAt &&
          existing.completedAt === args.completedAt
        ) {
          return sandboxExecutionValue(existing)
        }
        throw new ConvexError('Sandbox execution idempotency key conflict')
      }
      if (
        workflowRun.candidateIdentityVersion === 'incoming-pr-v1' &&
        args.executionGroupId !== undefined &&
        (executionGroup === null ||
          executionGroup.workflowRunId !== args.workflowRunId ||
          executionGroup.claimToken !== args.executionGroupClaimToken ||
          executionGroup.status !== 'running' ||
          executionGroup.sandboxId !== args.sandboxId ||
          executionGroup.providerSessionId !== args.providerSessionId ||
          executionGroup.providerCommandId !== args.providerCommandId ||
          executionGroup.sandboxExecutionId !== undefined ||
          args.idempotencyKey !==
            `${String(args.executionGroupId)}:sandbox-execution` ||
          !(await isLatestWorkflowAttempt(ctx, workflowRun)))
      ) {
        throw new ConvexError(
          'Incoming PR sandbox execution requires its active execution group',
        )
      }
      if (
        workflowRun.candidateIdentityVersion === 'incoming-pr-v1' &&
        args.executionGroupId === undefined &&
        (workflowRun.incomingDispatchStartedAt === undefined ||
          workflowRun.incomingDispatchToken !== args.incomingDispatchToken ||
          workflowRun.incomingDispatchSandboxId !== args.sandboxId ||
          !(await isLatestWorkflowAttempt(ctx, workflowRun)))
      ) {
        throw new ConvexError(
          'Incoming PR sandbox execution requires its active started dispatch',
        )
      }
      if (workflowRun.status !== 'running') {
        throw new ConvexError(
          'V1 sandbox execution requires an active execution claim',
        )
      }
      if (args.executionGroupId === undefined) {
        const existingExecution = await ctx.db
          .query('sandboxExecutions')
          .withIndex('by_workflow_run', (q) =>
            q.eq('workflowRunId', args.workflowRunId),
          )
          .first()
        if (existingExecution !== null) {
          throw new ConvexError(
            'V1 workflow attempt already has a sandbox execution',
          )
        }
      }
    }

    const id = await ctx.db.insert('sandboxExecutions', {
      workflowRunId: args.workflowRunId,
      ...(args.executionGroupId === undefined
        ? {}
        : { executionGroupId: args.executionGroupId }),
      ...(args.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: args.idempotencyKey }),
      provider: args.provider,
      sandboxId: args.sandboxId,
      ...(args.providerSessionId === undefined
        ? {}
        : { providerSessionId: args.providerSessionId }),
      ...(args.providerCommandId === undefined
        ? {}
        : { providerCommandId: args.providerCommandId }),
      command: args.command,
      status: args.status,
      ...(args.exitCode === undefined ? {} : { exitCode: args.exitCode }),
      stdout: args.stdout,
      ...(args.stderr === undefined ? {} : { stderr: args.stderr }),
      ...(args.policy === undefined ? {} : { policy: args.policy }),
      startedAt: args.startedAt,
      completedAt: args.completedAt,
      createdAt: Date.now(),
    })

    if (args.executionGroupId !== undefined) {
      await ctx.db.patch('verificationExecutionGroups', args.executionGroupId, {
        sandboxExecutionId: id,
      })
    }

    if (workflowRun.status === 'queued') {
      await ctx.db.patch('workflowRuns', args.workflowRunId, {
        status: 'running',
      })
    }

    await insertProvenanceEvent(ctx, {
      workflowRunId: args.workflowRunId,
      traceId: workflowRun.traceId ?? 'legacy',
      type: 'sandbox-execution',
      operation: 'sandboxExecution.command',
      pluginName: args.provider,
      status: args.status === 'succeeded' ? 'succeeded' : 'failed',
      startedAt: args.startedAt,
      completedAt: args.completedAt,
      summary: `${args.command} exited ${args.exitCode ?? 'unknown'}.`,
      artifactRefs: [String(id)],
      idempotencyKey: `${String(id)}:sandbox-execution`,
    })

    return {
      id,
      workflowRunId: args.workflowRunId,
      ...(args.executionGroupId === undefined
        ? {}
        : { executionGroupId: args.executionGroupId }),
      ...(args.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: args.idempotencyKey }),
      provider: args.provider,
      sandboxId: args.sandboxId,
      ...(args.providerSessionId === undefined
        ? {}
        : { providerSessionId: args.providerSessionId }),
      ...(args.providerCommandId === undefined
        ? {}
        : { providerCommandId: args.providerCommandId }),
      command: args.command,
      status: args.status,
      ...(args.exitCode === undefined ? {} : { exitCode: args.exitCode }),
      stdout: args.stdout,
      ...(args.stderr === undefined ? {} : { stderr: args.stderr }),
      ...(args.policy === undefined ? {} : { policy: args.policy }),
      startedAt: args.startedAt,
      completedAt: args.completedAt,
    }
  },
})

export const authorizeRuntimeControl = query({
  args: {
    workflowRunId: v.id('workflowRuns'),
  },
  returns: v.object({
    workflowRunId: v.id('workflowRuns'),
    workspaceId: v.string(),
    allowed: v.literal(true),
  }),
  handler: async (ctx, args) => {
    const identity = await requireWorkOSIdentity(ctx)
    const workflowRun = await ctx.db.get('workflowRuns', args.workflowRunId)

    if (workflowRun === null) {
      throw new ConvexError('Workflow run not found')
    }

    requireWorkOSWorkspace(identity, workflowRun.workspaceId)
    await requireMembershipPermission(
      ctx,
      identity,
      workflowRun.workspaceId,
      'run:interrupt',
    )

    return {
      workflowRunId: workflowRun['_id'],
      workspaceId: workflowRun.workspaceId,
      allowed: true as const,
    }
  },
})

export const recordHumanDecision = mutation({
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

export const recordQueuedGitHubDelivery = mutation({
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

export const claimStaleGitHubDeliveries = mutation({
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

export const getGitHubDeliveryReceipt = query({
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

export const claimGitHubDeliveryProcessing = mutation({
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

export const releaseGitHubDeliveryProcessing = mutation({
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

export const bindQueuedGitHubDeliveryToWorkflow = mutation({
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

export const completeQueuedGitHubDelivery = mutation({
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

export const terminalizeQueuedGitHubDelivery = mutation({
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

export const getTrustLoopWorkflowForDelivery = query({
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

export const getTrustLoopAcceptanceSnapshot = query({
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

export const getDecisionPublicationReplayFixture = query({
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

export const getDetail = query({
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

export const listRecent = query({
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
