import { Clock, Context, Effect, Layer, Option, Schema } from 'effect'
import type * as Redacted from 'effect/Redacted'
import {
  type AcceptanceDecision,
  type ActionAttribution,
  type ActiveAttemptConfigNotice,
  ActorId,
  type ApprovalActionCategory,
  AuditEventId,
  type AuthorityAuditEvent,
  canReadWithRepositoryPermission,
  ConfigFieldKey,
  ConfigFieldValue,
  ConfigVersion,
  type DecisionId,
  type DecisionKind,
  type DelegatedAgentAttribution,
  type DelegatedMcpGrant,
  type ForgeUserLogin,
  type HumanPrincipalAttribution,
  type HumanPrincipalId,
  McpAuthorizationError,
  McpGrantId,
  type McpSessionId,
  type McpSessionRecord,
  normalizeRepositoryKey,
  type OrganizationId,
  type PolicyRuleAttribution,
  type PolicyRuleId,
  type ProposalVersion,
  RepositoryAuthorityError,
  type RepositoryConfigRecord,
  type RepositoryId,
  type VerificationAttemptId,
} from '@patchplane/domain'
import { AuthorityStore, type RepositoryConfigPatch } from './authority-store'
import { ForgeAdapter } from './forge-adapter'
import { WorkOsAuthProvider } from './workos-auth'

/** Default session-scoped MCP grant lifetime (30 minutes) and hard upper cap (4 hours). */
export const DEFAULT_MCP_GRANT_TTL_MS = 30 * 60 * 1000
export const MAX_MCP_GRANT_TTL_MS = 4 * 60 * 60 * 1000

const isConfigFieldKey = Schema.is(ConfigFieldKey)
const decodeConfigFieldValue = Schema.decodeUnknownEffect(ConfigFieldValue)

type AuditEventPrefix =
  | 'evt-human-decision'
  | 'evt-policy-decision'
  | 'evt-grant-issued'
  | 'evt-grant-revoked'
  | 'evt-session-terminated'
  | 'evt-mcp-config-update'

const makeEventId = (prefix: AuditEventPrefix, now: number) =>
  Effect.sync(() =>
    AuditEventId.make(`${prefix}-${now}-${crypto.randomUUID()}`),
  )

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

export type SessionTerminatorCaller =
  | {
      readonly _tag: 'HumanSession'
      readonly sessionToken: Redacted.Redacted
    }
  | {
      readonly _tag: 'AuthenticatedMcpSession'
      readonly caller: AuthenticatedMcpAgentCaller
    }

export interface AuthenticatedMcpAgentCaller {
  readonly agentActorId: ActorId
  readonly sessionId: McpSessionId
  readonly organizationId: OrganizationId
  readonly humanPrincipalId: HumanPrincipalId
}

export interface DelegatedConfigUpdateResult {
  readonly config: RepositoryConfigRecord
  readonly attribution: DelegatedAgentAttribution
  readonly auditEvent: AuthorityAuditEvent
  readonly appliesAtNextRecordedAttempt: true
  readonly activeAttemptNotices: ReadonlyArray<ActiveAttemptConfigNotice>
}

export interface AuthorityServiceShape {
  readonly verifyHumanRepositoryAuthority: (input: {
    readonly sessionToken: Redacted.Redacted
    readonly repositoryId: RepositoryId
  }) => Effect.Effect<
    {
      readonly identity: {
        readonly principalId: HumanPrincipalId
        readonly organizationId: OrganizationId
        readonly forgeUserLogin: ForgeUserLogin
        readonly workOsSessionId: HumanPrincipalAttribution['workOsSessionId']
      }
      readonly permission: RepositoryAuthorityError['permission']
    },
    | import('@patchplane/domain').AuthenticationError
    | RepositoryAuthorityError
    | import('@patchplane/domain').ForgeAdapterError
  >

  readonly verifyMcpReadAccess: (input: {
    readonly caller: AuthenticatedMcpAgentCaller
    readonly repositoryId: RepositoryId
  }) => Effect.Effect<
    McpSessionRecord,
    | McpAuthorizationError
    | RepositoryAuthorityError
    | import('@patchplane/domain').AuthenticationError
    | import('@patchplane/domain').ForgeAdapterError
    | import('@patchplane/domain').PersistenceError
  >

  readonly verifyMcpAttemptReadAccess: (input: {
    readonly caller: AuthenticatedMcpAgentCaller
    readonly attemptId: VerificationAttemptId
  }) => Effect.Effect<
    {
      readonly session: McpSessionRecord
      readonly proposal: Option.Option<
        import('./authority-store').AttemptProposalVersionRecord
      >
    },
    | McpAuthorizationError
    | RepositoryAuthorityError
    | import('@patchplane/domain').AuthenticationError
    | import('@patchplane/domain').ForgeAdapterError
    | import('@patchplane/domain').PersistenceError
  >

  readonly recordHumanAcceptanceDecision: (input: {
    readonly sessionToken: Redacted.Redacted
    readonly decisionId: DecisionId
    readonly repositoryId: RepositoryId
    readonly attemptId: VerificationAttemptId
    readonly proposalVersion: ProposalVersion
    readonly kind: DecisionKind
  }) => Effect.Effect<
    {
      readonly decision: AcceptanceDecision
      readonly attribution: HumanPrincipalAttribution
      readonly auditEvent: Option.Option<AuthorityAuditEvent>
    },
    | import('@patchplane/domain').AuthenticationError
    | RepositoryAuthorityError
    | import('@patchplane/domain').ForgeAdapterError
    | import('@patchplane/domain').PersistenceError
    | import('@patchplane/domain').ProposalVersionNotFoundError
    | import('@patchplane/domain').StaleProposalVersionError
    | import('@patchplane/domain').ManualApprovalRequiredError
    | import('@patchplane/domain').ConflictingDecisionError
  >

  readonly recordPolicyRuleAcceptanceDecision: (input: {
    readonly decisionId: DecisionId
    readonly organizationId: OrganizationId
    readonly repositoryId: RepositoryId
    readonly attemptId: VerificationAttemptId
    readonly proposalVersion: ProposalVersion
    readonly category: ApprovalActionCategory
    readonly kind: DecisionKind
    readonly policyRuleId: PolicyRuleId
  }) => Effect.Effect<
    {
      readonly decision: AcceptanceDecision
      readonly attribution: PolicyRuleAttribution
      readonly auditEvent: Option.Option<AuthorityAuditEvent>
    },
    | import('@patchplane/domain').PersistenceError
    | import('@patchplane/domain').ProposalVersionNotFoundError
    | import('@patchplane/domain').StaleProposalVersionError
    | import('@patchplane/domain').ManualApprovalRequiredError
    | import('@patchplane/domain').ConflictingDecisionError
  >

  readonly issueSessionScopedMcpGrant: (input: {
    readonly caller: GrantIssuerCaller
    readonly grantId: McpGrantId
    readonly repositoryId: RepositoryId
    readonly agentActorId: ActorId
    readonly sessionId: McpSessionId
    readonly allowedFields: ReadonlyArray<ConfigFieldKey>
    readonly ttlMs?: number
  }) => Effect.Effect<
    DelegatedMcpGrant,
    | McpAuthorizationError
    | import('@patchplane/domain').AuthenticationError
    | RepositoryAuthorityError
    | import('@patchplane/domain').ForgeAdapterError
    | import('@patchplane/domain').PersistenceError
  >

  readonly revokeDelegatedMcpGrant: (input: {
    readonly caller: GrantIssuerCaller
    readonly grantId: McpGrantId
  }) => Effect.Effect<
    DelegatedMcpGrant,
    | McpAuthorizationError
    | import('@patchplane/domain').AuthenticationError
    | RepositoryAuthorityError
    | import('@patchplane/domain').ForgeAdapterError
    | import('@patchplane/domain').PersistenceError
  >

  readonly terminateMcpSession: (input: {
    readonly caller: SessionTerminatorCaller
    readonly sessionId: McpSessionId
  }) => Effect.Effect<
    {
      readonly session: Option.Option<McpSessionRecord>
      readonly expiredGrantCount: number
    },
    | McpAuthorizationError
    | import('@patchplane/domain').AuthenticationError
    | import('@patchplane/domain').PersistenceError
  >

  readonly applyDelegatedConfigUpdate: (input: {
    readonly caller: AuthenticatedMcpAgentCaller
    readonly grantId: McpGrantId
    readonly repositoryId: RepositoryId
    readonly expectedConfigVersion: ConfigVersion | null
    readonly patch: Readonly<Record<string, unknown>>
  }) => Effect.Effect<
    DelegatedConfigUpdateResult,
    | McpAuthorizationError
    | RepositoryAuthorityError
    | import('@patchplane/domain').AuthenticationError
    | import('@patchplane/domain').ForgeAdapterError
    | import('@patchplane/domain').PersistenceError
    | import('@patchplane/domain').StaleConfigVersionError
  >
}

export class AuthorityService extends Context.Service<
  AuthorityService,
  AuthorityServiceShape
>()('@patchplane/core/AuthorityService') {}

const validatePatchValueForField = (
  field: ConfigFieldKey,
  value: unknown,
): Effect.Effect<ConfigFieldValue, McpAuthorizationError> =>
  decodeConfigFieldValue(value).pipe(
    Effect.flatMap((decoded) => {
      const valid =
        field === 'verification.max_wall_clock_minutes'
          ? typeof decoded === 'number'
          : field === 'verification.auto_cancel_superseded'
            ? typeof decoded === 'boolean'
            : decoded === 'manual' || decoded === 'auto_policy'
      return valid
        ? Effect.succeed(decoded)
        : Effect.fail(
            new McpAuthorizationError({
              code: 'invalid_input',
              reason: `Value type is invalid for configuration field "${field}"`,
            }),
          )
    }),
    Effect.mapError((err) =>
      err._tag === 'McpAuthorizationError'
        ? err
        : new McpAuthorizationError({
            code: 'invalid_input',
            reason: `Invalid value for configuration field "${field}"`,
          }),
    ),
  )

export const AuthorityServiceLayer = Layer.effect(
  AuthorityService,
  Effect.gen(function* () {
    const authorityStore = yield* AuthorityStore
    const workos = yield* WorkOsAuthProvider
    const forge = yield* ForgeAdapter

    const verifyHumanRepositoryAuthority = Effect.fn(
      'AuthorityService.verifyHumanRepositoryAuthority',
    )(function* (input: {
      readonly sessionToken: Redacted.Redacted
      readonly repositoryId: RepositoryId
    }) {
      yield* Effect.annotateCurrentSpan({
        repositoryId: input.repositoryId,
      })

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

      return { identity, permission: authority.permission } as const
    })

    const verifyActiveSessionForCaller = Effect.fnUntraced(function* (
      caller: AuthenticatedMcpAgentCaller,
    ) {
      const sessionOpt = yield* authorityStore.findMcpSession(caller.sessionId)
      if (Option.isNone(sessionOpt) || sessionOpt.value.status !== 'active') {
        return yield* new McpAuthorizationError({
          code: 'session_terminated',
          reason: `MCP session "${caller.sessionId}" is not active`,
        })
      }
      const session = sessionOpt.value
      if (
        session.agentActorId !== caller.agentActorId ||
        session.organizationId !== caller.organizationId ||
        session.principalId !== caller.humanPrincipalId
      ) {
        return yield* new McpAuthorizationError({
          code: 'wrong_actor',
          reason: `Caller "${caller.agentActorId}" does not match MCP session "${caller.sessionId}"`,
        })
      }
      return session
    })

    const verifyMcpReadAccess = Effect.fn(
      'AuthorityService.verifyMcpReadAccess',
    )(function* (input: {
      readonly caller: AuthenticatedMcpAgentCaller
      readonly repositoryId: RepositoryId
    }) {
      yield* Effect.annotateCurrentSpan({
        sessionId: input.caller.sessionId,
        agentActorId: input.caller.agentActorId,
        repositoryId: input.repositoryId,
      })

      const session = yield* verifyActiveSessionForCaller(input.caller)
      const stillMember = yield* workos.verifyOrganizationMembership({
        principalId: session.principalId,
        organizationId: session.organizationId,
      })
      if (!stillMember) {
        return yield* new RepositoryAuthorityError({
          repositoryId: input.repositoryId,
          forgeUserLogin: session.principalForgeLogin,
          permission: 'none',
          reason: `Session principal "${session.principalId}" is not an active member of organization "${session.organizationId}"`,
        })
      }
      const authority = yield* forge.checkRepositoryAuthority({
        repositoryId: input.repositoryId,
        forgeUserLogin: session.principalForgeLogin,
      })
      if (!canReadWithRepositoryPermission(authority.permission)) {
        return yield* new RepositoryAuthorityError({
          repositoryId: input.repositoryId,
          forgeUserLogin: session.principalForgeLogin,
          permission: authority.permission,
          reason: `Session principal "${session.principalForgeLogin}" lacks read access to "${input.repositoryId}"`,
        })
      }
      return session
    })

    const verifyMcpAttemptReadAccess = Effect.fn(
      'AuthorityService.verifyMcpAttemptReadAccess',
    )(function* (input: {
      readonly caller: AuthenticatedMcpAgentCaller
      readonly attemptId: VerificationAttemptId
    }) {
      yield* Effect.annotateCurrentSpan({
        sessionId: input.caller.sessionId,
        attemptId: input.attemptId,
      })

      const session = yield* verifyActiveSessionForCaller(input.caller)
      const proposalOpt = yield* authorityStore.findCurrentProposalVersion(
        input.attemptId,
      )
      if (Option.isNone(proposalOpt)) {
        return { session, proposal: Option.none() } as const
      }
      const proposal = proposalOpt.value
      if (proposal.organizationId !== session.organizationId) {
        return { session, proposal: Option.none() } as const
      }
      const stillMember = yield* workos.verifyOrganizationMembership({
        principalId: session.principalId,
        organizationId: session.organizationId,
      })
      if (!stillMember) {
        return yield* new RepositoryAuthorityError({
          repositoryId: proposal.repositoryId,
          forgeUserLogin: session.principalForgeLogin,
          permission: 'none',
          reason: `Session principal "${session.principalId}" is not an active member of organization "${session.organizationId}"`,
        })
      }
      const authority = yield* forge.checkRepositoryAuthority({
        repositoryId: proposal.repositoryId,
        forgeUserLogin: session.principalForgeLogin,
      })
      if (!canReadWithRepositoryPermission(authority.permission)) {
        return yield* new RepositoryAuthorityError({
          repositoryId: proposal.repositoryId,
          forgeUserLogin: session.principalForgeLogin,
          permission: authority.permission,
          reason: `Session principal "${session.principalForgeLogin}" lacks read access to "${proposal.repositoryId}"`,
        })
      }
      return { session, proposal: Option.some(proposal) } as const
    })

    const recordHumanAcceptanceDecision = Effect.fn(
      'AuthorityService.recordHumanAcceptanceDecision',
    )(function* (input: {
      readonly sessionToken: Redacted.Redacted
      readonly decisionId: DecisionId
      readonly repositoryId: RepositoryId
      readonly attemptId: VerificationAttemptId
      readonly proposalVersion: ProposalVersion
      readonly kind: DecisionKind
    }) {
      yield* Effect.annotateCurrentSpan({
        repositoryId: input.repositoryId,
        attemptId: input.attemptId,
        proposalVersion: input.proposalVersion,
      })

      const { identity } = yield* verifyHumanRepositoryAuthority({
        sessionToken: input.sessionToken,
        repositoryId: input.repositoryId,
      })

      const now = yield* Clock.currentTimeMillis
      const auditEventId = yield* makeEventId('evt-human-decision', now)
      const attribution: HumanPrincipalAttribution = {
        _tag: 'HumanPrincipal',
        principalId: identity.principalId,
        organizationId: identity.organizationId,
        forgeUserLogin: identity.forgeUserLogin,
        workOsSessionId: identity.workOsSessionId,
      }

      const recorded = yield* authorityStore.recordDecisionAtomically({
        decisionId: input.decisionId,
        organizationId: identity.organizationId,
        repositoryId: input.repositoryId,
        attemptId: input.attemptId,
        proposalVersion: input.proposalVersion,
        kind: input.kind,
        actorId: ActorId.make(`human:${identity.principalId}`),
        action: `decision.${input.kind}`,
        attribution,
        auditEventId,
        createdAtMs: now,
      })

      return {
        decision: recorded.decision,
        attribution,
        auditEvent: recorded.auditEvent,
      } as const
    })

    const recordPolicyRuleAcceptanceDecision = Effect.fn(
      'AuthorityService.recordPolicyRuleAcceptanceDecision',
    )(function* (input: {
      readonly decisionId: DecisionId
      readonly organizationId: OrganizationId
      readonly repositoryId: RepositoryId
      readonly attemptId: VerificationAttemptId
      readonly proposalVersion: ProposalVersion
      readonly category: ApprovalActionCategory
      readonly kind: DecisionKind
      readonly policyRuleId: PolicyRuleId
    }) {
      yield* Effect.annotateCurrentSpan({
        repositoryId: input.repositoryId,
        attemptId: input.attemptId,
        proposalVersion: input.proposalVersion,
        policyRuleId: input.policyRuleId,
      })

      // Read attempt's frozen config version for attribution; the store
      // atomically re-verifies freshness and the frozen snapshot inside one TX.
      const proposalOpt = yield* authorityStore.findCurrentProposalVersion(
        input.attemptId,
      )
      const now = yield* Clock.currentTimeMillis
      const auditEventId = yield* makeEventId('evt-policy-decision', now)
      const previewPolicyVersion = Option.isSome(proposalOpt)
        ? proposalOpt.value.configVersion
        : ConfigVersion.make(1)

      const attribution: PolicyRuleAttribution = {
        _tag: 'PolicyRule',
        policyRuleId: input.policyRuleId,
        policyVersion: previewPolicyVersion,
        proposalVersion: input.proposalVersion,
      }

      const recorded = yield* authorityStore.recordDecisionAtomically({
        decisionId: input.decisionId,
        organizationId: input.organizationId,
        repositoryId: input.repositoryId,
        attemptId: input.attemptId,
        proposalVersion: input.proposalVersion,
        kind: input.kind,
        actorId: ActorId.make(
          `policy:${input.policyRuleId}@v${previewPolicyVersion}`,
        ),
        action: `policy_decision.${input.category}.${input.kind}`,
        attribution,
        policyCheck: {
          category: input.category,
          policyRuleId: input.policyRuleId,
        },
        auditEventId,
        createdAtMs: now,
      })

      return {
        decision: recorded.decision,
        attribution: {
          _tag: 'PolicyRule' as const,
          policyRuleId: input.policyRuleId,
          policyVersion: recorded.frozenConfigVersion,
          proposalVersion: input.proposalVersion,
        },
        auditEvent: recorded.auditEvent,
      } as const
    })

    const issueSessionScopedMcpGrant = Effect.fn(
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
      yield* Effect.annotateCurrentSpan({
        grantId: input.grantId,
        repositoryId: input.repositoryId,
        sessionId: input.sessionId,
      })

      if (input.caller._tag === 'AgentCaller') {
        return yield* new McpAuthorizationError({
          code: 'self_authorization_forbidden',
          reason: `Agent "${input.caller.agentActorId}" cannot issue or extend delegated MCP grants; human authorization is required`,
        })
      }

      const { identity } = yield* verifyHumanRepositoryAuthority({
        sessionToken: input.caller.sessionToken,
        repositoryId: input.repositoryId,
      })

      if (input.allowedFields.length === 0) {
        return yield* new McpAuthorizationError({
          code: 'invalid_input',
          reason:
            'Delegated grant must specify at least one allowed config field',
        })
      }
      const uniqueFields = [...new Set(input.allowedFields)]

      const requestedTtl = input.ttlMs ?? DEFAULT_MCP_GRANT_TTL_MS
      if (!Number.isFinite(requestedTtl) || requestedTtl <= 0) {
        return yield* new McpAuthorizationError({
          code: 'invalid_input',
          reason: 'Delegated grant TTL must be a positive finite duration',
        })
      }
      const boundedTtl = Math.min(
        Math.max(1_000, Math.floor(requestedTtl)),
        MAX_MCP_GRANT_TTL_MS,
      )

      const now = yield* Clock.currentTimeMillis
      const auditEventId = yield* makeEventId('evt-grant-issued', now)
      const attribution: HumanPrincipalAttribution = {
        _tag: 'HumanPrincipal',
        principalId: identity.principalId,
        organizationId: identity.organizationId,
        forgeUserLogin: identity.forgeUserLogin,
        workOsSessionId: identity.workOsSessionId,
      }

      return yield* authorityStore.issueDelegatedGrantWithAudit({
        grantId: input.grantId,
        organizationId: identity.organizationId,
        repositoryId: input.repositoryId,
        humanDelegatorId: identity.principalId,
        humanDelegatorForgeLogin: identity.forgeUserLogin,
        agentActorId: input.agentActorId,
        sessionId: input.sessionId,
        allowedFields: uniqueFields,
        createdAtMs: now,
        expiresAtMs: now + boundedTtl,
        attribution,
        auditEventId,
      })
    })

    const revokeDelegatedMcpGrant = Effect.fn(
      'AuthorityService.revokeDelegatedMcpGrant',
    )(function* (input: {
      readonly caller: GrantIssuerCaller
      readonly grantId: McpGrantId
    }) {
      yield* Effect.annotateCurrentSpan({ grantId: input.grantId })

      if (input.caller._tag === 'AgentCaller') {
        return yield* new McpAuthorizationError({
          code: 'self_authorization_forbidden',
          reason:
            'Only a human principal may manually revoke delegated MCP grants',
        })
      }

      // 1. Authenticate caller and verify org membership BEFORE looking up any
      //    grant so cross-tenant callers cannot probe grant IDs or repo names.
      const identity = yield* workos.verifySessionToken(
        input.caller.sessionToken,
      )
      const isMember = yield* workos.verifyOrganizationMembership({
        principalId: identity.principalId,
        organizationId: identity.organizationId,
      })
      if (!isMember) {
        return yield* new McpAuthorizationError({
          code: 'wrong_actor',
          reason: `Principal "${identity.principalId}" is not an active member of organization "${identity.organizationId}"`,
        })
      }

      const existingOpt = yield* authorityStore.findDelegatedGrant(
        input.grantId,
      )
      if (
        Option.isNone(existingOpt) ||
        existingOpt.value.organizationId !== identity.organizationId
      ) {
        return yield* new McpAuthorizationError({
          code: 'missing_grant',
          reason: `Delegated grant "${input.grantId}" was not found`,
        })
      }
      const existing = existingOpt.value

      // 2. Verify repo approval authority (or original delegator) on the grant's repo
      const authority = yield* forge.checkRepositoryAuthority({
        repositoryId: existing.repositoryId,
        forgeUserLogin: identity.forgeUserLogin,
      })
      if (
        !authority.canApprove &&
        identity.principalId !== existing.humanDelegatorId
      ) {
        return yield* new RepositoryAuthorityError({
          repositoryId: existing.repositoryId,
          forgeUserLogin: identity.forgeUserLogin,
          permission: authority.permission,
          reason: `Principal "${identity.principalId}" cannot revoke delegated grants on "${existing.repositoryId}"`,
        })
      }

      const now = yield* Clock.currentTimeMillis
      const auditEventId = yield* makeEventId('evt-grant-revoked', now)
      return yield* authorityStore.revokeDelegatedGrantWithAudit({
        grantId: existing.grantId,
        organizationId: identity.organizationId,
        revokedBy: identity.principalId,
        revokedAtMs: now,
        attribution: {
          _tag: 'HumanPrincipal',
          principalId: identity.principalId,
          organizationId: identity.organizationId,
          forgeUserLogin: identity.forgeUserLogin,
          workOsSessionId: identity.workOsSessionId,
        },
        auditEventId,
      })
    })

    const terminateMcpSession = Effect.fn(
      'AuthorityService.terminateMcpSession',
    )(function* (input: {
      readonly caller: SessionTerminatorCaller
      readonly sessionId: McpSessionId
    }) {
      yield* Effect.annotateCurrentSpan({ sessionId: input.sessionId })

      const sessionOpt = yield* authorityStore.findMcpSession(input.sessionId)
      let attribution: ActionAttribution

      if (input.caller._tag === 'HumanSession') {
        const identity = yield* workos.verifySessionToken(
          input.caller.sessionToken,
        )
        const isMember = yield* workos.verifyOrganizationMembership({
          principalId: identity.principalId,
          organizationId: identity.organizationId,
        })
        if (!isMember) {
          return yield* new McpAuthorizationError({
            code: 'wrong_actor',
            reason: `Principal "${identity.principalId}" is not an active member of organization "${identity.organizationId}"`,
          })
        }
        if (
          Option.isSome(sessionOpt) &&
          (sessionOpt.value.organizationId !== identity.organizationId ||
            sessionOpt.value.principalId !== identity.principalId)
        ) {
          return yield* new McpAuthorizationError({
            code: 'wrong_actor',
            reason: `Principal "${identity.principalId}" cannot terminate MCP session "${input.sessionId}"`,
          })
        }
        attribution = {
          _tag: 'HumanPrincipal',
          principalId: identity.principalId,
          organizationId: identity.organizationId,
          forgeUserLogin: identity.forgeUserLogin,
          workOsSessionId: identity.workOsSessionId,
        }
      } else {
        const caller = input.caller.caller
        if (caller.sessionId !== input.sessionId) {
          return yield* new McpAuthorizationError({
            code: 'wrong_actor',
            reason: `Agent "${caller.agentActorId}" cannot terminate another session "${input.sessionId}"`,
          })
        }
        if (
          Option.isSome(sessionOpt) &&
          (sessionOpt.value.agentActorId !== caller.agentActorId ||
            sessionOpt.value.organizationId !== caller.organizationId ||
            sessionOpt.value.principalId !== caller.humanPrincipalId)
        ) {
          return yield* new McpAuthorizationError({
            code: 'wrong_actor',
            reason: `Agent "${caller.agentActorId}" does not own MCP session "${input.sessionId}"`,
          })
        }
        attribution = {
          _tag: 'DelegatedAgent',
          agentActorId: caller.agentActorId,
          humanDelegatorId: caller.humanPrincipalId,
          organizationId: caller.organizationId,
          grantId: McpGrantId.make(`session-termination-${caller.sessionId}`),
          sessionId: caller.sessionId,
        }
      }

      const now = yield* Clock.currentTimeMillis
      const prefixEventId = yield* makeEventId('evt-session-terminated', now)
      return yield* authorityStore.terminateMcpSessionWithAudit({
        sessionId: input.sessionId,
        terminatedAtMs: now,
        attribution,
        auditEventIdPrefix: prefixEventId,
      })
    })

    const applyDelegatedConfigUpdate = Effect.fn(
      'AuthorityService.applyDelegatedConfigUpdate',
    )(function* (input: {
      readonly caller: AuthenticatedMcpAgentCaller
      readonly grantId: McpGrantId
      readonly repositoryId: RepositoryId
      readonly expectedConfigVersion: ConfigVersion | null
      readonly patch: Readonly<Record<string, unknown>>
    }) {
      yield* Effect.annotateCurrentSpan({
        grantId: input.grantId,
        sessionId: input.caller.sessionId,
        agentActorId: input.caller.agentActorId,
        repositoryId: input.repositoryId,
      })

      // 1. Validate active MCP session bound to this caller & principal
      const session = yield* verifyActiveSessionForCaller(input.caller)

      // 2. Pre-validate grant existence, binding, status, and expiry
      const grantOpt = yield* authorityStore.findDelegatedGrant(input.grantId)
      if (Option.isNone(grantOpt)) {
        return yield* new McpAuthorizationError({
          code: 'missing_grant',
          reason: `Delegated MCP grant "${input.grantId}" does not exist`,
        })
      }
      const grant = grantOpt.value
      if (
        grant.agentActorId !== input.caller.agentActorId ||
        grant.sessionId !== input.caller.sessionId ||
        grant.organizationId !== input.caller.organizationId ||
        grant.humanDelegatorId !== session.principalId
      ) {
        return yield* new McpAuthorizationError({
          code: 'wrong_actor',
          reason: `Delegated grant "${input.grantId}" is not issued to agent "${input.caller.agentActorId}" in session "${input.caller.sessionId}"`,
        })
      }
      if (
        normalizeRepositoryKey(grant.repositoryId) !==
        normalizeRepositoryKey(input.repositoryId)
      ) {
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
      const preCheckNow = yield* Clock.currentTimeMillis
      if (grant.status === 'expired' || preCheckNow >= grant.expiresAtMs) {
        return yield* new McpAuthorizationError({
          code: 'grant_expired',
          reason: `Delegated grant "${input.grantId}" has expired`,
        })
      }

      // 3. Validate patch keys/values BEFORE external network calls
      const entries = Object.entries(input.patch)
      if (entries.length === 0) {
        return yield* new McpAuthorizationError({
          code: 'invalid_input',
          reason: 'Configuration update patch must specify at least one field',
        })
      }
      if (entries.length > grant.allowedFields.length) {
        return yield* new McpAuthorizationError({
          code: 'field_not_permitted',
          reason: `Patch contains ${entries.length} fields, exceeding grant "${grant.grantId}" scope (${grant.allowedFields.length})`,
        })
      }

      const allowedSet = new Set<string>(grant.allowedFields)
      const decodedPatch: Partial<Record<ConfigFieldKey, ConfigFieldValue>> = {}

      for (const [rawKey, rawValue] of entries) {
        const displayKey = rawKey.slice(0, 64)
        if (/grant|authority|delegat|permission|session|token/i.test(rawKey)) {
          return yield* new McpAuthorizationError({
            code: 'self_authorization_forbidden',
            reason: `Agent cannot modify authorization or grant field "${displayKey}" via configuration updates`,
          })
        }
        if (!isConfigFieldKey(rawKey)) {
          return yield* new McpAuthorizationError({
            code: 'field_not_permitted',
            reason: `Unknown configuration field "${displayKey}"`,
          })
        }
        if (!allowedSet.has(rawKey)) {
          return yield* new McpAuthorizationError({
            code: 'field_not_permitted',
            reason: `Field "${rawKey}" is not permitted by delegated grant "${grant.grantId}"`,
          })
        }
        decodedPatch[rawKey] = yield* validatePatchValueForField(
          rawKey,
          rawValue,
        )
      }

      // 4. Re-verify upstream human delegator using the IMMUTABLY BOUND
      //    `grant.humanDelegatorForgeLogin` (never a caller-supplied login!)
      const delegatorStillMember = yield* workos.verifyOrganizationMembership({
        principalId: grant.humanDelegatorId,
        organizationId: grant.organizationId,
      })
      if (!delegatorStillMember) {
        return yield* new RepositoryAuthorityError({
          repositoryId: input.repositoryId,
          forgeUserLogin: grant.humanDelegatorForgeLogin,
          permission: 'none',
          reason: `Human delegator "${grant.humanDelegatorId}" is no longer a member of organization "${grant.organizationId}"`,
        })
      }
      const delegatorAuthority = yield* forge.checkRepositoryAuthority({
        repositoryId: grant.repositoryId,
        forgeUserLogin: grant.humanDelegatorForgeLogin,
      })
      if (!delegatorAuthority.canApprove) {
        return yield* new RepositoryAuthorityError({
          repositoryId: grant.repositoryId,
          forgeUserLogin: grant.humanDelegatorForgeLogin,
          permission: delegatorAuthority.permission,
          reason: `Human delegator "${grant.humanDelegatorForgeLogin}" no longer holds approval authority on "${grant.repositoryId}"`,
        })
      }

      // 5. Commit atomically with a FRESH timestamp inside the Postgres
      //    transaction (re-locking session + grant + config row so concurrent
      //    revocation/termination/expiry or concurrent config edits fail closed)
      const commitNow = yield* Clock.currentTimeMillis
      const auditEventId = yield* makeEventId(
        'evt-mcp-config-update',
        commitNow,
      )
      const attribution: DelegatedAgentAttribution = {
        _tag: 'DelegatedAgent',
        agentActorId: input.caller.agentActorId,
        humanDelegatorId: grant.humanDelegatorId,
        organizationId: grant.organizationId,
        grantId: grant.grantId,
        sessionId: grant.sessionId,
      }

      const patch: RepositoryConfigPatch = decodedPatch
      const updated = yield* authorityStore.applyDelegatedConfigPatchWithAudit({
        organizationId: grant.organizationId,
        repositoryId: grant.repositoryId,
        grantId: grant.grantId,
        sessionId: grant.sessionId,
        agentActorId: grant.agentActorId,
        humanDelegatorId: grant.humanDelegatorId,
        expectedVersion: input.expectedConfigVersion,
        patch,
        attribution,
        auditEventId,
        updatedAtMs: commitNow,
      })

      return {
        config: updated.config,
        attribution,
        auditEvent: updated.auditEvent,
        appliesAtNextRecordedAttempt: true,
        activeAttemptNotices: updated.activeAttemptNotices,
      } satisfies DelegatedConfigUpdateResult
    })

    return AuthorityService.of({
      verifyHumanRepositoryAuthority,
      verifyMcpReadAccess,
      verifyMcpAttemptReadAccess,
      recordHumanAcceptanceDecision,
      recordPolicyRuleAcceptanceDecision,
      issueSessionScopedMcpGrant,
      revokeDelegatedMcpGrant,
      terminateMcpSession,
      applyDelegatedConfigUpdate,
    })
  }),
)
