import { v } from 'convex/values'

import { historicalSandboxPolicyReturn } from './foundation'
export const reviewRunKindArg = v.union(
  v.literal('test'),
  v.literal('lint'),
  v.literal('policy'),
  v.literal('manual'),
)

export const reviewRunStatusArg = v.union(
  v.literal('queued'),
  v.literal('running'),
  v.literal('completed'),
  v.literal('failed'),
)

export const reviewRunReturn = v.object({
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

export const reviewFindingSeverityArg = v.union(
  v.literal('info'),
  v.literal('warning'),
  v.literal('error'),
  v.literal('critical'),
)

export const reviewFindingCategoryArg = v.union(
  v.literal('test'),
  v.literal('lint'),
  v.literal('security'),
  v.literal('policy'),
  v.literal('quality'),
  v.literal('unknown'),
)

export const reviewFindingReturn = v.object({
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

export const decisionStatusArg = v.union(
  v.literal('approved'),
  v.literal('rejected'),
  v.literal('changes-requested'),
)

export const policyDecisionStatusArg = v.union(
  v.literal('approved'),
  v.literal('rejected'),
  v.literal('changes-requested'),
  v.literal('manual-review'),
)

export const policyDecisionReturn = v.object({
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

export const humanDecisionReturn = v.object({
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

export const publicationResultKindArg = v.union(
  v.literal('issue-comment'),
  v.literal('check-run'),
  v.literal('draft-pull-request'),
  v.literal('branch'),
)

export const publicationResultStatusArg = v.union(
  v.literal('pending'),
  v.literal('published'),
  v.literal('failed'),
)

export const publicationResultReturn = v.object({
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

export const provenanceEventStatusArg = v.union(
  v.literal('started'),
  v.literal('succeeded'),
  v.literal('failed'),
  v.literal('blocked'),
)

export const provenanceEventReturn = v.object({
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

export const runtimeEventReturn = v.object({
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

export const runtimeSessionStatusArg = v.union(
  v.literal('starting'),
  v.literal('running'),
  v.literal('completed'),
  v.literal('failed'),
  v.literal('cancelled'),
)

export const runtimeSessionReturn = v.object({
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

export const sandboxExecutionReturn = v.object({
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
  policy: v.optional(historicalSandboxPolicyReturn),
  startedAt: v.number(),
  completedAt: v.number(),
})
