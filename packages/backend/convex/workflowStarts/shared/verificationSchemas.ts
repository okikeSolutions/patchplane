import { v } from 'convex/values'

export const evidenceArtifactKindArg = v.union(
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

export const evidenceArtifactReturn = v.object({
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

export const candidateSubjectArg = v.union(
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

export const candidatePatchSetStatusArg = v.union(
  v.literal('captured'),
  v.literal('empty'),
  v.literal('failed'),
)

export const candidatePatchSetStatsArg = v.object({
  filesChanged: v.number(),
  additions: v.number(),
  deletions: v.number(),
})

export const candidatePatchSetReturn = v.object({
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

export const verificationRequirementKindArg = v.union(
  v.literal('test'),
  v.literal('lint'),
  v.literal('build'),
  v.literal('browser'),
  v.literal('security'),
  v.literal('review'),
)

export const verificationRequirementSourceArg = v.union(
  v.literal('repository-config'),
  v.literal('intake'),
  v.literal('policy'),
  v.literal('human'),
)

export const verificationPlatformArg = v.union(
  v.literal('linux'),
  v.literal('windows'),
  v.literal('macos'),
)

export const verificationExecutionGroupStatusArg = v.union(
  v.literal('claimed'),
  v.literal('running'),
  v.literal('completed'),
  v.literal('failed'),
  v.literal('blocked'),
  v.literal('cancelled'),
)

export const verificationLogCaptureStatusArg = v.union(
  v.literal('captured'),
  v.literal('truncated'),
  v.literal('failed'),
)

export const sandboxCleanupStatusArg = v.union(
  v.literal('deleted'),
  v.literal('failed'),
  v.literal('retained'),
  v.literal('not-started'),
)

export const verificationResultStatusArg = v.union(
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

export const verificationPlanSourceArg = v.object({
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

export const verificationPlanRequirementArg = v.object({
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

export const verificationPlanReturn = v.object({
  id: v.id('verificationPlans'),
  workflowRunId: v.id('workflowRuns'),
  version: v.literal('verification-plan-v1'),
  sources: v.array(verificationPlanSourceArg),
  requirements: v.array(verificationPlanRequirementArg),
  digest: v.string(),
  createdAt: v.number(),
})

export const verificationRequirementReturn = v.object({
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

export const verificationExecutionGroupReturn = v.object({
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

export const verificationResultReturn = v.object({
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
