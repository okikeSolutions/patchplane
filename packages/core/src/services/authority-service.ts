import { Clock, Effect, Option, Schema } from 'effect'
import type * as Redacted from 'effect/Redacted'
import {
  type AcceptanceDecision,
  ActorId,
  type ApprovalActionCategory,
  type ApprovalRuleMode,
  AuditEventId,
  type AuthorityAuditEvent,
  ConfigFieldKey,
  ConfigFieldValue,
  ConfigVersion,
  DEFAULT_REPOSITORY_CONFIG_VALUES,
  type DecisionId,
  type DecisionKind,
  type DelegatedAgentAttribution,
  type DelegatedMcpGrant,
  type ForgeUserLogin,
  type HumanPrincipalAttribution,
  type HumanPrincipalId,
  McpAuthorizationError,
  type McpGrantId,
  type McpSessionId,
  type OrganizationId,
  type PolicyRuleAttribution,
  type PolicyRuleId,
  type ProposalVersion,
  RepositoryAuthorityError,
  type RepositoryConfigRecord,
  RepositoryConfigValues,
  type RepositoryId,
  StaleProposalVersionError,
  type VerificationAttemptId,
} from '@patchplane/domain'
import { AcceptanceStore } from './acceptance-store'
import { AuthorityStore } from './authority-store'
import { ForgeAdapter } from './forge-adapter'
import { WorkOsAuthProvider } from './workos-auth'

/** Default session-scoped MCP grant lifetime (30 minutes) and hard upper cap (4 hours). */
export const DEFAULT_MCP_GRANT_TTL_MS = 30 * 60 * 1000
export const MAX_MCP_GRANT_TTL_MS = 4 * 60 * 60 * 1000

const CATEGORY_TO_CONFIG_FIELD: Record<
  ApprovalActionCategory,
  | 'approval.requirement_approval'
  | 'approval.extension_activation'
  | 'approval.waiver'
> = {
  requirement_approval: 'approval.requirement_approval',
  extension_activation: 'approval.extension_activation',
  waiver: 'approval.waiver',
}

const makeEventId = Effect.fnUntraced(function* (prefix: string) {
  const now = yield* Clock.currentTimeMillis
  const suffix = crypto.randomUUID().slice(0, 12)
  return yield* Schema.decodeEffect(AuditEventId)(`${prefix}-${now}-${suffix}`)
})

/**
 * Verifies BOTH WorkOS identity/org membership AND independent Forge repository
 * authority. WorkOS sign-in alone NEVER grants repository approval rights.
 */
export const verifyHumanRepositoryAuthority = Effect.fn(
  'AuthorityService.verifyHumanRepositoryAuthority',
)(function* (input: {
  readonly sessionToken: Redacted.Redacted
  readonly repositoryId: RepositoryId
}) {
  const workos = yield* WorkOsAuthProvider
  const forge = yield* ForgeAdapter

  const identity = yield* workos.verifySessionToken(input.sessionToken)
  const isMember = yield* workos.verifyOrganizationMembership({
    principalId: identity.principalId,
    organizationId: identity.organizationId,
  })
  if (!isMember) {
    return yield* new RepositoryAuthorityError({
      repositoryId: input.repositoryId,
      forgeUserLogin: identity.forgeUserLogin,
      permission: 'none',
      reason: `Principal "${identity.principalId}" is not an active member of organization "${identity.organizationId}"`,
    })
  }

  const authority = yield* forge.checkRepositoryAuthority({
    repositoryId: input.repositoryId,
    forgeUserLogin: identity.forgeUserLogin,
  })
  if (!authority.canApprove) {
    return yield* new RepositoryAuthorityError({
      repositoryId: input.repositoryId,
      forgeUserLogin: identity.forgeUserLogin,
      permission: authority.permission,
      reason: `User "${identity.forgeUserLogin}" has "${authority.permission}" permission on "${input.repositoryId}" via ${authority.provider}; repository write/maintain/admin authority is required`,
    })
  }

  return { identity, authority } as const
})

const assertFreshProposalVersion = Effect.fnUntraced(function* (input: {
  readonly attemptId: VerificationAttemptId
  readonly repositoryId: RepositoryId
  readonly proposalVersion: ProposalVersion
}) {
  const authorityStore = yield* AuthorityStore
  const currentOpt = yield* authorityStore.findCurrentProposalVersion(
    input.attemptId,
  )
  if (Option.isNone(currentOpt)) {
    return yield* new McpAuthorizationError({
      code: 'wrong_repository',
      reason: `No registered proposal version found for attempt "${input.attemptId}"`,
    })
  }
  const current = currentOpt.value
  if (current.repositoryId !== input.repositoryId) {
    return yield* new McpAuthorizationError({
      code: 'wrong_repository',
      reason: `Attempt "${input.attemptId}" belongs to repository "${current.repositoryId}", not "${input.repositoryId}"`,
    })
  }
  if (current.currentVersion !== input.proposalVersion) {
    return yield* new StaleProposalVersionError({
      attemptId: input.attemptId,
      expectedVersion: current.currentVersion,
      actualVersion: input.proposalVersion,
    })
  }
  return undefined
})

/**
 * Records a human acceptance decision ONLY after BOTH WorkOS identity + org
 * membership AND independent Forge repository authority pass, AND the proposal
 * version matches the attempt's current version.
 */
export const recordHumanAcceptanceDecision = Effect.fn(
  'AuthorityService.recordHumanAcceptanceDecision',
)(function* (input: {
  readonly sessionToken: Redacted.Redacted
  readonly decisionId: DecisionId
  readonly repositoryId: RepositoryId
  readonly attemptId: VerificationAttemptId
  readonly proposalVersion: ProposalVersion
  readonly kind: DecisionKind
}) {
  const acceptanceStore = yield* AcceptanceStore
  const authorityStore = yield* AuthorityStore

  const { identity } = yield* verifyHumanRepositoryAuthority({
    sessionToken: input.sessionToken,
    repositoryId: input.repositoryId,
  })

  yield* assertFreshProposalVersion({
    attemptId: input.attemptId,
    repositoryId: input.repositoryId,
    proposalVersion: input.proposalVersion,
  })

  const actorId = ActorId.make(`human:${identity.principalId}`)
  const decision: AcceptanceDecision = yield* acceptanceStore.recordDecision({
    decisionId: input.decisionId,
    attemptId: input.attemptId,
    proposalVersion: input.proposalVersion,
    kind: input.kind,
    actorId,
  })

  const attribution: HumanPrincipalAttribution = {
    _tag: 'HumanPrincipal',
    principalId: identity.principalId,
    organizationId: identity.organizationId,
    forgeUserLogin: identity.forgeUserLogin,
    workOsSessionId: identity.workOsSessionId,
  }
  const now = yield* Clock.currentTimeMillis
  const eventId = yield* makeEventId('evt-human-decision').pipe(Effect.orDie)
  const auditEvent = yield* authorityStore.recordAuditEvent({
    eventId,
    repositoryId: input.repositoryId,
    action: `decision.${input.kind}`,
    attemptId: input.attemptId,
    proposalVersion: input.proposalVersion,
    attribution,
    createdAtMs: now,
  })

  return { decision, attribution, auditEvent } as const
})

/**
 * Records an automatic policy-rule decision (ADR 0007) ONLY when the
 * repository's active configuration explicitly enables `auto_policy` for the
 * action category. Attribution always records `PolicyRule` (rule id, policy
 * version, proposal version) and NEVER impersonates a human click.
 */
export const recordPolicyRuleAcceptanceDecision = Effect.fn(
  'AuthorityService.recordPolicyRuleAcceptanceDecision',
)(function* (input: {
  readonly decisionId: DecisionId
  readonly repositoryId: RepositoryId
  readonly attemptId: VerificationAttemptId
  readonly proposalVersion: ProposalVersion
  readonly category: ApprovalActionCategory
  readonly kind: DecisionKind
  readonly policyRuleId: PolicyRuleId
}) {
  const acceptanceStore = yield* AcceptanceStore
  const authorityStore = yield* AuthorityStore

  const configOpt = yield* authorityStore.getRepositoryConfig(
    input.repositoryId,
  )
  const configValues = Option.isSome(configOpt)
    ? configOpt.value.values
    : DEFAULT_REPOSITORY_CONFIG_VALUES
  const policyVersion: ConfigVersion = Option.isSome(configOpt)
    ? configOpt.value.version
    : ConfigVersion.make(1)

  const field = CATEGORY_TO_CONFIG_FIELD[input.category]
  const mode: ApprovalRuleMode = configValues[field]
  if (mode !== 'auto_policy') {
    return yield* new McpAuthorizationError({
      code: 'policy_requires_manual_approval',
      reason: `Action category "${input.category}" on "${input.repositoryId}" requires manual human approval (mode="${mode}")`,
    })
  }

  yield* assertFreshProposalVersion({
    attemptId: input.attemptId,
    repositoryId: input.repositoryId,
    proposalVersion: input.proposalVersion,
  })

  const actorId = ActorId.make(`policy:${input.policyRuleId}@v${policyVersion}`)
  const decision = yield* acceptanceStore.recordDecision({
    decisionId: input.decisionId,
    attemptId: input.attemptId,
    proposalVersion: input.proposalVersion,
    kind: input.kind,
    actorId,
  })

  const attribution: PolicyRuleAttribution = {
    _tag: 'PolicyRule',
    policyRuleId: input.policyRuleId,
    policyVersion,
    proposalVersion: input.proposalVersion,
  }
  const now = yield* Clock.currentTimeMillis
  const eventId = yield* makeEventId('evt-policy-decision').pipe(Effect.orDie)
  const auditEvent = yield* authorityStore.recordAuditEvent({
    eventId,
    repositoryId: input.repositoryId,
    action: `policy_decision.${input.category}.${input.kind}`,
    attemptId: input.attemptId,
    proposalVersion: input.proposalVersion,
    attribution,
    createdAtMs: now,
  })

  return { decision, attribution, auditEvent } as const
})

export type GrantIssuerCaller =
  | {
      readonly _tag: 'HumanSession'
      readonly sessionToken: Redacted.Redacted
    }
  | {
      readonly _tag: 'AgentCaller'
      readonly agentActorId: ActorId
      readonly sessionId: McpSessionId
    }

/**
 * Issues a session-scoped delegated MCP configuration grant.
 *
 * Security-by-design invariants:
 * - Agents CANNOT issue, renew, or broaden grants (`self_authorization_forbidden`).
 * - Issuing human must pass BOTH WorkOS identity/org membership AND Forge
 *   repository authority on the target `repositoryId`.
 * - Target MCP session must be active and belong to the same human & org.
 * - Grant scope is strictly `'session'` and automatically expires when the
 *   session terminates or when `expiresAtMs` passes.
 */
export const issueSessionScopedMcpGrant = Effect.fn(
  'AuthorityService.issueSessionScopedMcpGrant',
)(function* (input: {
  readonly caller: GrantIssuerCaller
  readonly grantId: McpGrantId
  readonly repositoryId: RepositoryId
  readonly agentActorId: ActorId
  readonly sessionId: McpSessionId
  readonly allowedFields: ReadonlyArray<ConfigFieldKey>
  readonly ttlMs?: number
}) {
  if (input.caller._tag === 'AgentCaller') {
    return yield* new McpAuthorizationError({
      code: 'self_authorization_forbidden',
      reason: `Agent "${input.caller.agentActorId}" cannot issue or extend delegated MCP grants; human authorization is required`,
    })
  }

  const authorityStore = yield* AuthorityStore

  const { identity } = yield* verifyHumanRepositoryAuthority({
    sessionToken: input.caller.sessionToken,
    repositoryId: input.repositoryId,
  })

  if (input.allowedFields.length === 0) {
    return yield* new McpAuthorizationError({
      code: 'field_not_permitted',
      reason: 'Delegated grant must specify at least one allowed config field',
    })
  }
  const uniqueFields = [...new Set(input.allowedFields)]

  const sessionOpt = yield* authorityStore.findMcpSession(input.sessionId)
  if (Option.isNone(sessionOpt)) {
    return yield* new McpAuthorizationError({
      code: 'session_terminated',
      reason: `MCP session "${input.sessionId}" does not exist`,
    })
  }
  const session = sessionOpt.value
  if (session.status !== 'active') {
    return yield* new McpAuthorizationError({
      code: 'session_terminated',
      reason: `MCP session "${input.sessionId}" is already terminated`,
    })
  }
  if (
    session.principalId !== identity.principalId ||
    session.organizationId !== identity.organizationId
  ) {
    return yield* new McpAuthorizationError({
      code: 'wrong_actor',
      reason: `MCP session "${input.sessionId}" does not belong to human principal "${identity.principalId}"`,
    })
  }
  if (session.agentActorId !== input.agentActorId) {
    return yield* new McpAuthorizationError({
      code: 'wrong_actor',
      reason: `MCP session "${input.sessionId}" is bound to agent "${session.agentActorId}", not "${input.agentActorId}"`,
    })
  }

  const now = yield* Clock.currentTimeMillis
  const requestedTtl = input.ttlMs ?? DEFAULT_MCP_GRANT_TTL_MS
  const boundedTtl = Math.min(
    Math.max(1_000, Math.floor(requestedTtl)),
    MAX_MCP_GRANT_TTL_MS,
  )
  const grant = yield* authorityStore.issueDelegatedGrant({
    grantId: input.grantId,
    organizationId: identity.organizationId,
    repositoryId: input.repositoryId,
    humanDelegatorId: identity.principalId,
    agentActorId: input.agentActorId,
    sessionId: input.sessionId,
    allowedFields: uniqueFields,
    createdAtMs: now,
    expiresAtMs: now + boundedTtl,
  })

  const eventId = yield* makeEventId('evt-grant-issued').pipe(Effect.orDie)
  yield* authorityStore.recordAuditEvent({
    eventId,
    repositoryId: input.repositoryId,
    action: 'mcp_grant.issued',
    attribution: {
      _tag: 'HumanPrincipal',
      principalId: identity.principalId,
      organizationId: identity.organizationId,
      forgeUserLogin: identity.forgeUserLogin,
      workOsSessionId: identity.workOsSessionId,
    },
    grantId: grant.grantId,
    createdAtMs: now,
  })

  return grant
})

/**
 * Immediately revokes an active delegated MCP grant. Only a verified human
 * principal (the original delegator or a repository approver in the same org)
 * can revoke grants.
 */
export const revokeDelegatedMcpGrant = Effect.fn(
  'AuthorityService.revokeDelegatedMcpGrant',
)(function* (input: {
  readonly caller: GrantIssuerCaller
  readonly grantId: McpGrantId
}) {
  if (input.caller._tag === 'AgentCaller') {
    return yield* new McpAuthorizationError({
      code: 'self_authorization_forbidden',
      reason: 'Only a human principal may manually revoke delegated MCP grants',
    })
  }

  const authorityStore = yield* AuthorityStore
  const existingOpt = yield* authorityStore.findDelegatedGrant(input.grantId)
  if (Option.isNone(existingOpt)) {
    return yield* new McpAuthorizationError({
      code: 'missing_grant',
      reason: `Delegated grant "${input.grantId}" was not found`,
    })
  }
  const existing = existingOpt.value

  const { identity } = yield* verifyHumanRepositoryAuthority({
    sessionToken: input.caller.sessionToken,
    repositoryId: existing.repositoryId,
  })
  if (identity.organizationId !== existing.organizationId) {
    return yield* new McpAuthorizationError({
      code: 'wrong_actor',
      reason: `Principal "${identity.principalId}" cannot revoke grants outside organization "${existing.organizationId}"`,
    })
  }

  const now = yield* Clock.currentTimeMillis
  const revokedOpt = yield* authorityStore.revokeDelegatedGrant({
    grantId: input.grantId,
    revokedBy: identity.principalId,
    revokedAtMs: now,
  })
  if (Option.isNone(revokedOpt)) {
    return yield* new McpAuthorizationError({
      code: 'missing_grant',
      reason: `Delegated grant "${input.grantId}" could not be revoked`,
    })
  }

  const eventId = yield* makeEventId('evt-grant-revoked').pipe(Effect.orDie)
  yield* authorityStore.recordAuditEvent({
    eventId,
    repositoryId: existing.repositoryId,
    action: 'mcp_grant.revoked',
    attribution: {
      _tag: 'HumanPrincipal',
      principalId: identity.principalId,
      organizationId: identity.organizationId,
      forgeUserLogin: identity.forgeUserLogin,
      workOsSessionId: identity.workOsSessionId,
    },
    grantId: existing.grantId,
    createdAtMs: now,
  })

  return revokedOpt.value
})

/**
 * Terminates an MCP session and automatically expires all active
 * session-scoped delegated grants bound to it.
 */
export const terminateMcpSessionAndExpireGrants = Effect.fn(
  'AuthorityService.terminateMcpSession',
)(function* (sessionId: McpSessionId) {
  const authorityStore = yield* AuthorityStore
  const now = yield* Clock.currentTimeMillis
  return yield* authorityStore.terminateMcpSession({
    sessionId,
    terminatedAtMs: now,
  })
})

export interface AuthenticatedMcpAgentCaller {
  readonly agentActorId: ActorId
  readonly sessionId: McpSessionId
  readonly organizationId: OrganizationId
  readonly humanPrincipalId: HumanPrincipalId
  readonly humanForgeLogin: ForgeUserLogin
}

export interface DelegatedConfigUpdateResult {
  readonly config: RepositoryConfigRecord
  readonly attribution: DelegatedAgentAttribution
  readonly auditEvent: AuthorityAuditEvent
  readonly appliesAtNextRecordedAttempt: true
}

/**
 * Server-enforced delegated configuration mutation executed on behalf of an
 * authenticated MCP agent caller. Validates EVERY security boundary server-side:
 * session active, grant active/unexpired/unrevoked, exact actor/session/repo
 * binding, delegator still authorized in org + forge, field allowlist, no
 * grant/authority self-escalation, and optimistic config version CAS.
 */
export const applyDelegatedConfigUpdate = Effect.fn(
  'AuthorityService.applyDelegatedConfigUpdate',
)(function* (input: {
  readonly caller: AuthenticatedMcpAgentCaller
  readonly grantId: McpGrantId
  readonly repositoryId: RepositoryId
  readonly expectedConfigVersion: ConfigVersion | null
  readonly patch: Readonly<Record<string, unknown>>
}) {
  const authorityStore = yield* AuthorityStore
  const workos = yield* WorkOsAuthProvider
  const forge = yield* ForgeAdapter

  // 1. Validate active MCP session bound to this caller
  const sessionOpt = yield* authorityStore.findMcpSession(
    input.caller.sessionId,
  )
  if (Option.isNone(sessionOpt) || sessionOpt.value.status !== 'active') {
    return yield* new McpAuthorizationError({
      code: 'session_terminated',
      reason: `MCP session "${input.caller.sessionId}" is not active`,
    })
  }
  const session = sessionOpt.value
  if (
    session.agentActorId !== input.caller.agentActorId ||
    session.organizationId !== input.caller.organizationId
  ) {
    return yield* new McpAuthorizationError({
      code: 'wrong_actor',
      reason: `Caller "${input.caller.agentActorId}" does not match session "${input.caller.sessionId}"`,
    })
  }

  // 2. Validate grant existence, session/actor/repo binding, status, and expiry
  const grantOpt = yield* authorityStore.findDelegatedGrant(input.grantId)
  if (Option.isNone(grantOpt)) {
    return yield* new McpAuthorizationError({
      code: 'missing_grant',
      reason: `Delegated MCP grant "${input.grantId}" does not exist`,
    })
  }
  const grant: DelegatedMcpGrant = grantOpt.value
  if (
    grant.agentActorId !== input.caller.agentActorId ||
    grant.sessionId !== input.caller.sessionId ||
    grant.organizationId !== input.caller.organizationId
  ) {
    return yield* new McpAuthorizationError({
      code: 'wrong_actor',
      reason: `Delegated grant "${input.grantId}" is not issued to agent "${input.caller.agentActorId}" in session "${input.caller.sessionId}"`,
    })
  }
  if (grant.repositoryId !== input.repositoryId) {
    return yield* new McpAuthorizationError({
      code: 'wrong_repository',
      reason: `Delegated grant "${input.grantId}" is scoped to "${grant.repositoryId}", not "${input.repositoryId}"`,
    })
  }
  if (grant.status === 'revoked') {
    return yield* new McpAuthorizationError({
      code: 'grant_revoked',
      reason: `Delegated grant "${input.grantId}" was revoked`,
    })
  }
  const now = yield* Clock.currentTimeMillis
  if (grant.status === 'expired' || now >= grant.expiresAtMs) {
    return yield* new McpAuthorizationError({
      code: 'grant_expired',
      reason: `Delegated grant "${input.grantId}" has expired`,
    })
  }

  // 3. Re-verify upstream human delegator still holds org membership & repo authority
  const delegatorStillMember = yield* workos.verifyOrganizationMembership({
    principalId: grant.humanDelegatorId,
    organizationId: grant.organizationId,
  })
  if (!delegatorStillMember) {
    return yield* new RepositoryAuthorityError({
      repositoryId: input.repositoryId,
      forgeUserLogin: input.caller.humanForgeLogin,
      permission: 'none',
      reason: `Human delegator "${grant.humanDelegatorId}" is no longer a member of organization "${grant.organizationId}"`,
    })
  }
  const delegatorAuthority = yield* forge.checkRepositoryAuthority({
    repositoryId: input.repositoryId,
    forgeUserLogin: input.caller.humanForgeLogin,
  })
  if (!delegatorAuthority.canApprove) {
    return yield* new RepositoryAuthorityError({
      repositoryId: input.repositoryId,
      forgeUserLogin: input.caller.humanForgeLogin,
      permission: delegatorAuthority.permission,
      reason: `Human delegator "${input.caller.humanForgeLogin}" no longer holds approval authority on "${input.repositoryId}"`,
    })
  }

  // 4. Reject empty patches, grant/authority self-escalation, unknown keys,
  //    or fields outside `grant.allowedFields`
  const entries = Object.entries(input.patch)
  if (entries.length === 0) {
    return yield* new McpAuthorizationError({
      code: 'field_not_permitted',
      reason: 'Configuration update patch must specify at least one field',
    })
  }

  const allowedSet = new Set<string>(grant.allowedFields)
  const decodedPatch: Partial<Record<ConfigFieldKey, unknown>> = {}

  for (const [rawKey, rawValue] of entries) {
    if (/grant|authority|delegat|permission|session|token/i.test(rawKey)) {
      return yield* new McpAuthorizationError({
        code: 'self_authorization_forbidden',
        reason: `Agent cannot modify authorization or grant field "${rawKey}" via configuration updates`,
      })
    }
    const keyOpt = yield* Schema.decodeUnknownEffect(ConfigFieldKey)(
      rawKey,
    ).pipe(
      Effect.asSome,
      Effect.catch(() => Effect.succeedNone),
    )
    if (Option.isNone(keyOpt)) {
      return yield* new McpAuthorizationError({
        code: 'field_not_permitted',
        reason: `Unknown configuration field "${rawKey}"`,
      })
    }
    const fieldKey = keyOpt.value
    if (!allowedSet.has(fieldKey)) {
      return yield* new McpAuthorizationError({
        code: 'field_not_permitted',
        reason: `Field "${fieldKey}" is not permitted by delegated grant "${grant.grantId}"`,
      })
    }
    const validatedValue = yield* Schema.decodeUnknownEffect(ConfigFieldValue)(
      rawValue,
    ).pipe(
      Effect.mapError(
        () =>
          new McpAuthorizationError({
            code: 'field_not_permitted',
            reason: `Invalid value for configuration field "${fieldKey}"`,
          }),
      ),
    )
    decodedPatch[fieldKey] = validatedValue
  }

  // 5. Merge against current config and validate the full config struct
  const existingConfigOpt = yield* authorityStore.getRepositoryConfig(
    input.repositoryId,
  )
  const baseValues = Option.isSome(existingConfigOpt)
    ? existingConfigOpt.value.values
    : DEFAULT_REPOSITORY_CONFIG_VALUES

  const nextValues = yield* Schema.decodeUnknownEffect(RepositoryConfigValues)({
    'approval.requirement_approval':
      decodedPatch['approval.requirement_approval'] ??
      baseValues['approval.requirement_approval'],
    'approval.extension_activation':
      decodedPatch['approval.extension_activation'] ??
      baseValues['approval.extension_activation'],
    'approval.waiver':
      decodedPatch['approval.waiver'] ?? baseValues['approval.waiver'],
    'verification.max_wall_clock_minutes':
      decodedPatch['verification.max_wall_clock_minutes'] ??
      baseValues['verification.max_wall_clock_minutes'],
    'verification.auto_cancel_superseded':
      decodedPatch['verification.auto_cancel_superseded'] ??
      baseValues['verification.auto_cancel_superseded'],
  }).pipe(
    Effect.mapError(
      () =>
        new McpAuthorizationError({
          code: 'field_not_permitted',
          reason: 'Merged repository configuration failed schema validation',
        }),
    ),
  )

  const attribution: DelegatedAgentAttribution = {
    _tag: 'DelegatedAgent',
    agentActorId: input.caller.agentActorId,
    humanDelegatorId: grant.humanDelegatorId,
    organizationId: grant.organizationId,
    grantId: grant.grantId,
    sessionId: grant.sessionId,
  }
  const auditEventId = yield* makeEventId('evt-mcp-config-update').pipe(
    Effect.orDie,
  )

  const updated = yield* authorityStore.updateRepositoryConfigWithAudit({
    repositoryId: input.repositoryId,
    expectedVersion: input.expectedConfigVersion,
    values: nextValues,
    attribution,
    auditEventId,
    grantId: grant.grantId,
    updatedAtMs: now,
  })

  return {
    config: updated.config,
    attribution,
    auditEvent: updated.auditEvent,
    appliesAtNextRecordedAttempt: true,
  } satisfies DelegatedConfigUpdateResult
})
