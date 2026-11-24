import { Context, type Effect, type Option } from 'effect'
import type {
  AcceptanceDecision,
  ActionAttribution,
  ActiveAttemptConfigNotice,
  ActorId,
  ApprovalActionCategory,
  AuditEventId,
  AuthorityAuditEvent,
  ConfigFieldKey,
  ConfigFieldValue,
  ConfigVersion,
  ConflictingDecisionError,
  DecisionId,
  DecisionKind,
  DelegatedAgentAttribution,
  DelegatedMcpGrant,
  ForgeUserLogin,
  HumanPrincipalAttribution,
  HumanPrincipalId,
  ManualApprovalRequiredError,
  McpAuthorizationError,
  McpGrantId,
  McpSessionId,
  McpSessionRecord,
  OrganizationId,
  PersistenceError,
  PolicyRuleId,
  ProposalVersion,
  ProposalVersionNotFoundError,
  RepositoryConfigRecord,
  RepositoryConfigValues,
  RepositoryId,
  StaleConfigVersionError,
  StaleProposalVersionError,
  VerificationAttemptId,
} from '@patchplane/domain'

export interface AttemptProposalVersionRecord {
  readonly attemptId: VerificationAttemptId
  readonly organizationId: OrganizationId
  readonly repositoryId: RepositoryId
  readonly currentVersion: ProposalVersion
  readonly configVersion: ConfigVersion
  readonly configSnapshot: RepositoryConfigValues
  readonly updatedAtMs: number
}

export type RepositoryConfigPatch = Readonly<
  Partial<Record<ConfigFieldKey, ConfigFieldValue>>
>

export interface AuthorityStoreService {
  readonly createMcpSession: (input: {
    readonly sessionId: McpSessionId
    readonly organizationId: OrganizationId
    readonly principalId: HumanPrincipalId
    readonly principalForgeLogin: ForgeUserLogin
    readonly agentActorId: ActorId
    readonly createdAtMs: number
  }) => Effect.Effect<McpSessionRecord, PersistenceError>

  readonly findMcpSession: (
    sessionId: McpSessionId,
  ) => Effect.Effect<Option.Option<McpSessionRecord>, PersistenceError>

  /**
   * Atomically marks the MCP session terminated, expires every active
   * session-scoped delegated grant bound to it, and appends session-termination
   * audit events for affected repositories in one Postgres transaction.
   */
  readonly terminateMcpSessionWithAudit: (input: {
    readonly sessionId: McpSessionId
    readonly terminatedAtMs: number
    readonly attribution: ActionAttribution
    readonly auditEventIdPrefix: string
  }) => Effect.Effect<
    {
      readonly session: Option.Option<McpSessionRecord>
      readonly expiredGrantCount: number
    },
    PersistenceError
  >

  /**
   * Atomically locks the target MCP session (`status = 'active'`), verifies
   * principal/org/agent ownership, inserts the session-scoped grant, and
   * appends the `mcp_grant.issued` audit event in one transaction.
   */
  readonly issueDelegatedGrantWithAudit: (input: {
    readonly grantId: McpGrantId
    readonly organizationId: OrganizationId
    readonly repositoryId: RepositoryId
    readonly humanDelegatorId: HumanPrincipalId
    readonly humanDelegatorForgeLogin: ForgeUserLogin
    readonly agentActorId: ActorId
    readonly sessionId: McpSessionId
    readonly allowedFields: ReadonlyArray<ConfigFieldKey>
    readonly createdAtMs: number
    readonly expiresAtMs: number
    readonly attribution: HumanPrincipalAttribution
    readonly auditEventId: AuditEventId
  }) => Effect.Effect<
    DelegatedMcpGrant,
    PersistenceError | McpAuthorizationError
  >

  readonly findDelegatedGrant: (
    grantId: McpGrantId,
  ) => Effect.Effect<Option.Option<DelegatedMcpGrant>, PersistenceError>

  /**
   * Atomically transitions an `'active'` grant to `'revoked'` and appends a
   * single `mcp_grant.revoked` audit event. Already-revoked grants return
   * idempotently without duplicating audit events; `'expired'` grants fail
   * cleanly with `McpAuthorizationError('grant_expired')`.
   */
  readonly revokeDelegatedGrantWithAudit: (input: {
    readonly grantId: McpGrantId
    readonly organizationId: OrganizationId
    readonly revokedBy: HumanPrincipalId
    readonly revokedAtMs: number
    readonly attribution: HumanPrincipalAttribution
    readonly auditEventId: AuditEventId
  }) => Effect.Effect<
    DelegatedMcpGrant,
    PersistenceError | McpAuthorizationError
  >

  /**
   * Registers or bumps an attempt's proposal version. On initial registration
   * for an attempt, snapshots the repository's current configuration (or
   * defaults) so later config edits apply ONLY at the next recorded attempt
   * (ADR 0007 Q24/Q28).
   */
  readonly setCurrentProposalVersion: (input: {
    readonly attemptId: VerificationAttemptId
    readonly organizationId: OrganizationId
    readonly repositoryId: RepositoryId
    readonly currentVersion: ProposalVersion
    readonly updatedAtMs: number
  }) => Effect.Effect<AttemptProposalVersionRecord, PersistenceError>

  readonly findCurrentProposalVersion: (
    attemptId: VerificationAttemptId,
  ) => Effect.Effect<
    Option.Option<AttemptProposalVersionRecord>,
    PersistenceError
  >

  /**
   * Atomically locks the attempt's proposal version row, verifies freshness
   * (and for policy-rule decisions, checks the attempt's FROZEN config
   * snapshot), inserts into `acceptance_decisions`, and writes the matching
   * `authority_audit_events` row ONLY when newly inserted (idempotent on replay).
   */
  readonly recordDecisionAtomically: (input: {
    readonly decisionId: DecisionId
    readonly organizationId: OrganizationId
    readonly repositoryId: RepositoryId
    readonly attemptId: VerificationAttemptId
    readonly proposalVersion: ProposalVersion
    readonly kind: DecisionKind
    readonly actorId: ActorId
    readonly action: string
    readonly attribution: ActionAttribution
    readonly policyCheck?: {
      readonly category: ApprovalActionCategory
      readonly policyRuleId: PolicyRuleId
    }
    readonly auditEventId: AuditEventId
    readonly createdAtMs: number
  }) => Effect.Effect<
    {
      readonly decision: AcceptanceDecision
      readonly auditEvent: Option.Option<AuthorityAuditEvent>
      readonly frozenConfigVersion: ConfigVersion
    },
    | PersistenceError
    | ProposalVersionNotFoundError
    | StaleProposalVersionError
    | ManualApprovalRequiredError
    | ConflictingDecisionError
  >

  readonly getRepositoryConfig: (input: {
    readonly organizationId: OrganizationId
    readonly repositoryId: RepositoryId
  }) => Effect.Effect<Option.Option<RepositoryConfigRecord>, PersistenceError>

  /**
   * Atomically locks the session + delegated grant (`FOR SHARE`), re-verifies
   * session active + grant active/unexpired + exact actor/org/repo binding
   * inside Postgres, locks `repository_configs` (`FOR UPDATE`), verifies
   * `expectedVersion`, merges the validated partial `patch`, writes the new
   * config + `authority_audit_events` row, and queries active attempts to emit
   * ADR 0007 Q24 active-attempt configuration change notices.
   */
  readonly applyDelegatedConfigPatchWithAudit: (input: {
    readonly organizationId: OrganizationId
    readonly repositoryId: RepositoryId
    readonly grantId: McpGrantId
    readonly sessionId: McpSessionId
    readonly agentActorId: ActorId
    readonly humanDelegatorId: HumanPrincipalId
    readonly expectedVersion: ConfigVersion | null
    readonly patch: RepositoryConfigPatch
    readonly attribution: DelegatedAgentAttribution
    readonly auditEventId: AuditEventId
    readonly updatedAtMs: number
  }) => Effect.Effect<
    {
      readonly config: RepositoryConfigRecord
      readonly auditEvent: AuthorityAuditEvent
      readonly activeAttemptNotices: ReadonlyArray<ActiveAttemptConfigNotice>
    },
    PersistenceError | McpAuthorizationError | StaleConfigVersionError
  >

  readonly listAuditEventsByRepository: (input: {
    readonly organizationId: OrganizationId
    readonly repositoryId: RepositoryId
    readonly limit?: number
  }) => Effect.Effect<ReadonlyArray<AuthorityAuditEvent>, PersistenceError>
}

export class AuthorityStore extends Context.Service<
  AuthorityStore,
  AuthorityStoreService
>()('@patchplane/core/AuthorityStore') {}
