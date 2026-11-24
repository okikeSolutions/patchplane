import { Context, type Effect, type Option } from 'effect'
import type {
  ActionAttribution,
  ActorId,
  AuditEventId,
  AuthorityAuditEvent,
  ConfigFieldKey,
  ConfigVersion,
  DelegatedMcpGrant,
  HumanPrincipalId,
  McpGrantId,
  McpSessionId,
  McpSessionRecord,
  OrganizationId,
  PersistenceError,
  ProposalVersion,
  RepositoryConfigRecord,
  RepositoryConfigValues,
  RepositoryId,
  StaleConfigVersionError,
  VerificationAttemptId,
} from '@patchplane/domain'

export interface AttemptProposalVersionRecord {
  readonly attemptId: VerificationAttemptId
  readonly repositoryId: RepositoryId
  readonly currentVersion: ProposalVersion
  readonly updatedAtMs: number
}

export interface AuthorityStoreService {
  readonly createMcpSession: (input: {
    readonly sessionId: McpSessionId
    readonly organizationId: OrganizationId
    readonly principalId: HumanPrincipalId
    readonly agentActorId: ActorId
    readonly createdAtMs: number
  }) => Effect.Effect<McpSessionRecord, PersistenceError>

  readonly findMcpSession: (
    sessionId: McpSessionId,
  ) => Effect.Effect<Option.Option<McpSessionRecord>, PersistenceError>

  /**
   * Atomically marks the MCP session terminated and expires every active
   * session-scoped delegated grant bound to that session.
   */
  readonly terminateMcpSession: (input: {
    readonly sessionId: McpSessionId
    readonly terminatedAtMs: number
  }) => Effect.Effect<
    {
      readonly session: Option.Option<McpSessionRecord>
      readonly expiredGrantCount: number
    },
    PersistenceError
  >

  readonly issueDelegatedGrant: (input: {
    readonly grantId: McpGrantId
    readonly organizationId: OrganizationId
    readonly repositoryId: RepositoryId
    readonly humanDelegatorId: HumanPrincipalId
    readonly agentActorId: ActorId
    readonly sessionId: McpSessionId
    readonly allowedFields: ReadonlyArray<ConfigFieldKey>
    readonly createdAtMs: number
    readonly expiresAtMs: number
  }) => Effect.Effect<DelegatedMcpGrant, PersistenceError>

  readonly findDelegatedGrant: (
    grantId: McpGrantId,
  ) => Effect.Effect<Option.Option<DelegatedMcpGrant>, PersistenceError>

  readonly revokeDelegatedGrant: (input: {
    readonly grantId: McpGrantId
    readonly revokedBy: HumanPrincipalId
    readonly revokedAtMs: number
  }) => Effect.Effect<Option.Option<DelegatedMcpGrant>, PersistenceError>

  readonly setCurrentProposalVersion: (input: {
    readonly attemptId: VerificationAttemptId
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

  readonly getRepositoryConfig: (
    repositoryId: RepositoryId,
  ) => Effect.Effect<Option.Option<RepositoryConfigRecord>, PersistenceError>

  /**
   * Optimistically updates repository configuration (`version === expectedVersion`)
   * and appends the matching `AuthorityAuditEvent` in the same Postgres transaction.
   */
  readonly updateRepositoryConfigWithAudit: (input: {
    readonly repositoryId: RepositoryId
    readonly expectedVersion: ConfigVersion | null
    readonly values: RepositoryConfigValues
    readonly attribution: ActionAttribution
    readonly auditEventId: AuditEventId
    readonly grantId?: McpGrantId
    readonly updatedAtMs: number
  }) => Effect.Effect<
    {
      readonly config: RepositoryConfigRecord
      readonly auditEvent: AuthorityAuditEvent
    },
    PersistenceError | StaleConfigVersionError
  >

  readonly recordAuditEvent: (
    event: AuthorityAuditEvent,
  ) => Effect.Effect<AuthorityAuditEvent, PersistenceError>

  readonly listAuditEventsByRepository: (
    repositoryId: RepositoryId,
  ) => Effect.Effect<ReadonlyArray<AuthorityAuditEvent>, PersistenceError>
}

export class AuthorityStore extends Context.Service<
  AuthorityStore,
  AuthorityStoreService
>()('@patchplane/core/AuthorityStore') {}
