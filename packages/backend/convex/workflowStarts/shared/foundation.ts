import type { UserIdentity } from 'convex/server'
import type { Doc } from '../../_generated/dataModel'
import { ConvexError, v } from 'convex/values'
import {
  historicalProtectedExecutionPolicyValidator,
  protectedExecutionPolicyValidator,
} from '../../protectedExecutionValidator'
import type { MutationCtx, QueryCtx } from '../../_generated/server'

export const incomingDispatchRecoveryTimeoutMs = 60 * 60 * 1_000

export const verificationExecutionGroupRecoveryTimeoutMs = 60 * 60 * 1_000

export const workflowDetailRuntimeEventLimit = 100

export const workflowDetailRuntimePayloadPreviewLength = 8_000

export const workflowDetailSandboxExecutionLimit = 32

export const workflowDetailSandboxCommandPreviewLength = 1_000

export const workflowDetailSandboxOutputPreviewLength = 16_000

export function isEpochMillis(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

export function isValidProviderProcessIdentityPair(
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

export const workflowDetailVerificationRequirementLimit = 64

export const workflowDetailVerificationResultLimit = 128

export const workflowDetailRuntimeSessionLimit = 32

export const workflowDetailEvidenceArtifactLimit = 64

export const workflowDetailCandidatePatchSetLimit = 32

export const workflowDetailReviewRunLimit = 32

export const workflowDetailReviewFindingLimit = 128

export const workflowDetailPolicyDecisionLimit = 32

export const workflowDetailHumanDecisionLimit = 32

export const workflowDetailPublicationResultLimit = 64

export const workflowDetailProvenanceEventLimit = 128

export function publicationResultFromDocument(
  result: Doc<'publicationResults'>,
) {
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

export function runtimePayloadPreview(payloadJson: string | undefined) {
  if (
    payloadJson === undefined ||
    payloadJson.length <= workflowDetailRuntimePayloadPreviewLength
  ) {
    return payloadJson
  }

  return `${payloadJson.slice(0, workflowDetailRuntimePayloadPreviewLength)}\n…truncated; full runtime output remains in the workflow evidence artifact…`
}

export function sandboxOutputPreview(output: string | undefined) {
  if (
    output === undefined ||
    output.length <= workflowDetailSandboxOutputPreviewLength
  ) {
    return output
  }

  return `${output.slice(0, workflowDetailSandboxOutputPreviewLength)}\n…truncated; full sandbox output remains in the workflow evidence artifact…`
}

export function sandboxCommandPreview(command: string) {
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

export function sandboxRuntimeModel(command: string) {
  const match =
    /(?:^|\s)["']?--model["']?(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s]+))/i.exec(
      command,
    )
  return match?.slice(1).find((value) => value !== undefined)
}

export function workOSOrganizationId(identity: UserIdentity) {
  const value =
    identity.organizationId ??
    identity.orgId ??
    identity.organization_id ??
    identity.org_id

  return typeof value === 'string' && value.length > 0 ? value : null
}

export function requireWorkOSWorkspace(
  identity: UserIdentity,
  workspaceId: string,
) {
  const organizationId = workOSOrganizationId(identity)

  if (organizationId === null) {
    throw new ConvexError('Active WorkOS organization required')
  }

  if (workspaceId !== `workos:${organizationId}`) {
    throw new ConvexError('Workspace mismatch')
  }
}

export async function requireWorkOSIdentity(ctx: {
  auth: { getUserIdentity(): Promise<UserIdentity | null> }
}) {
  const identity = await ctx.auth.getUserIdentity()

  if (identity === null) {
    throw new ConvexError('Authentication required')
  }

  return identity
}

export function workspaceOrganizationId(workspaceId: string) {
  return workspaceId.startsWith('workos:')
    ? workspaceId.slice('workos:'.length)
    : null
}

export async function requireMembershipPermission(
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

export const externalWorkflowRefArg = v.object({
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

export const workflowStartArgs = {
  workspaceId: v.string(),
  actorId: v.string(),
  actorDisplayName: v.string(),
  source: v.union(v.literal('dev'), v.literal('app'), v.literal('external')),
  traceId: v.string(),
  prompt: v.string(),
}

export const protectedExecutionPolicyArg = protectedExecutionPolicyValidator

export const sandboxLifecyclePolicyValidator = v.object({
  ephemeral: v.boolean(),
  retainAfterRun: v.boolean(),
  autoStopMinutes: v.optional(v.number()),
  autoArchiveMinutes: v.optional(v.number()),
  autoDeleteMinutes: v.optional(v.number()),
})

export const sandboxNetworkPolicyValidator = v.object({
  blockAll: v.optional(v.boolean()),
  allowList: v.optional(v.string()),
})

export const sandboxResourcesPolicyValidator = v.object({
  cpu: v.optional(v.number()),
  memoryGb: v.optional(v.number()),
  diskGb: v.optional(v.number()),
})

export const sandboxEnvironmentPolicyValidator = v.object({
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
})

export const sandboxPolicyFields = {
  lifecycle: sandboxLifecyclePolicyValidator,
  network: sandboxNetworkPolicyValidator,
  resources: sandboxResourcesPolicyValidator,
  environment: v.optional(sandboxEnvironmentPolicyValidator),
  timeoutSeconds: v.optional(v.number()),
} as const

export const sandboxPolicyArg = v.object({
  ...sandboxPolicyFields,
  protectedExecution: v.optional(protectedExecutionPolicyArg),
})

export const historicalSandboxPolicyReturn = v.object({
  ...sandboxPolicyFields,
  protectedExecution: v.optional(historicalProtectedExecutionPolicyValidator),
})

export function sortedByNumber<A>(
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
