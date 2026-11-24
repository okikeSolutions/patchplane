import { Effect, Layer, Option, Schema } from 'effect'
import { SqlClient } from 'effect/sql'
import {
  type AttemptProposalVersionRecord,
  AuthorityStore,
  type RepositoryConfigPatch,
} from '@patchplane/core'
import {
  type AcceptanceDecision,
  ActionAttribution,
  type ActiveAttemptConfigNotice,
  ActorId,
  type ApprovalActionCategory,
  AuditEventId,
  type AuthorityAuditEvent,
  ConfigFieldKey,
  ConfigVersion,
  ConflictingDecisionError,
  DecisionId,
  DecisionKind,
  DEFAULT_REPOSITORY_CONFIG_VALUES,
  type DelegatedMcpGrant,
  DelegatedMcpGrantStatus,
  ForgeUserLogin,
  HumanPrincipalId,
  ManualApprovalRequiredError,
  McpAuthorizationError,
  McpGrantId,
  McpSessionId,
  type McpSessionRecord,
  McpSessionStatus,
  normalizeRepositoryKey,
  OrganizationId,
  PersistenceError,
  ProposalVersion,
  ProposalVersionNotFoundError,
  type RepositoryConfigRecord,
  RepositoryConfigValues,
  RepositoryId,
  sanitizeErrorMessage,
  StaleConfigVersionError,
  StaleProposalVersionError,
  VerificationAttemptId,
} from '@patchplane/domain'

const DEFAULT_AUDIT_LIST_LIMIT = 100
const MAX_AUDIT_LIST_LIMIT = 500

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

const persistenceError = (operation: string, cause: unknown) =>
  new PersistenceError({
    operation,
    message: sanitizeErrorMessage(cause),
  })

const PositiveSafeIntInput = Schema.Union([
  Schema.Int.check(Schema.isGreaterThan(0)),
  Schema.String.check(Schema.isPattern(/^[1-9]\d*$/)),
  Schema.BigInt,
])

const parsePositiveSafeInt = Effect.fnUntraced(function* (
  operation: string,
  field: string,
  raw: typeof PositiveSafeIntInput.Type,
) {
  const num = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isSafeInteger(num) || num <= 0) {
    return yield* new PersistenceError({
      operation,
      message: `Invalid positive safe integer in column "${field}"`,
    })
  }
  return num
})

const AllowedFieldsColumn = Schema.Union([
  Schema.Array(ConfigFieldKey).check(Schema.isMinLength(1)),
  Schema.fromJsonString(
    Schema.Array(ConfigFieldKey).check(Schema.isMinLength(1)),
  ),
])

const ConfigValuesColumn = Schema.Union([
  RepositoryConfigValues,
  Schema.fromJsonString(RepositoryConfigValues),
])

const AttributionColumn = Schema.Union([
  ActionAttribution,
  Schema.fromJsonString(ActionAttribution),
])

const McpSessionRow = Schema.Struct({
  session_id: McpSessionId,
  organization_id: OrganizationId,
  principal_id: HumanPrincipalId,
  principal_forge_login: ForgeUserLogin,
  agent_actor_id: ActorId,
  status: McpSessionStatus,
  created_at_ms: PositiveSafeIntInput,
  terminated_at_ms: Schema.NullOr(PositiveSafeIntInput),
})

const DelegatedGrantRow = Schema.Struct({
  grant_id: McpGrantId,
  organization_id: OrganizationId,
  repository_id: RepositoryId,
  human_delegator_id: HumanPrincipalId,
  human_delegator_forge_login: ForgeUserLogin,
  agent_actor_id: ActorId,
  session_id: McpSessionId,
  allowed_fields: AllowedFieldsColumn,
  scope: Schema.Literal('session'),
  status: DelegatedMcpGrantStatus,
  created_at_ms: PositiveSafeIntInput,
  expires_at_ms: PositiveSafeIntInput,
  revoked_at_ms: Schema.NullOr(PositiveSafeIntInput),
  revoked_by: Schema.NullOr(HumanPrincipalId),
})

const ProposalVersionRow = Schema.Struct({
  attempt_id: VerificationAttemptId,
  organization_id: OrganizationId,
  repository_id: RepositoryId,
  current_version: ProposalVersion,
  config_version: ConfigVersion,
  config_snapshot: ConfigValuesColumn,
  updated_at_ms: PositiveSafeIntInput,
})

const RepositoryConfigRow = Schema.Struct({
  repository_id: RepositoryId,
  organization_id: OrganizationId,
  version: ConfigVersion,
  config_values: ConfigValuesColumn,
  updated_by_attribution: AttributionColumn,
  updated_at_ms: PositiveSafeIntInput,
})

const AuditEventRow = Schema.Struct({
  event_id: AuditEventId,
  organization_id: OrganizationId,
  repository_id: RepositoryId,
  action: Schema.NonEmptyString,
  attempt_id: Schema.NullOr(VerificationAttemptId),
  proposal_version: Schema.NullOr(ProposalVersion),
  attribution: AttributionColumn,
  grant_id: Schema.NullOr(McpGrantId),
  before_config_version: Schema.NullOr(ConfigVersion),
  after_config_version: Schema.NullOr(ConfigVersion),
  created_at_ms: PositiveSafeIntInput,
})

const DecisionRow = Schema.Struct({
  id: DecisionId,
  attempt_id: VerificationAttemptId,
  proposal_version: ProposalVersion,
  kind: DecisionKind,
  actor_id: ActorId,
})

const ActiveAttemptIdRow = Schema.Struct({
  attempt_id: VerificationAttemptId,
})

const ExpiredGrantRepoRow = Schema.Struct({
  repository_id: RepositoryId,
})

const mergeConfigPatch = (
  base: RepositoryConfigValues,
  patch: RepositoryConfigPatch,
): RepositoryConfigValues => {
  const req = patch['approval.requirement_approval']
  const ext = patch['approval.extension_activation']
  const waiver = patch['approval.waiver']
  const maxWall = patch['verification.max_wall_clock_minutes']
  const autoCancel = patch['verification.auto_cancel_superseded']
  return {
    'approval.requirement_approval':
      req === 'manual' || req === 'auto_policy'
        ? req
        : base['approval.requirement_approval'],
    'approval.extension_activation':
      ext === 'manual' || ext === 'auto_policy'
        ? ext
        : base['approval.extension_activation'],
    'approval.waiver':
      waiver === 'manual' || waiver === 'auto_policy'
        ? waiver
        : base['approval.waiver'],
    'verification.max_wall_clock_minutes':
      typeof maxWall === 'number'
        ? maxWall
        : base['verification.max_wall_clock_minutes'],
    'verification.auto_cancel_superseded':
      typeof autoCancel === 'boolean'
        ? autoCancel
        : base['verification.auto_cancel_superseded'],
  }
}

const decodeSessionRow = Effect.fnUntraced(function* (
  operation: string,
  row: unknown,
) {
  const decoded = yield* Schema.decodeUnknownEffect(McpSessionRow)(row).pipe(
    Effect.mapError((cause) => persistenceError(operation, cause)),
  )
  const createdAtMs = yield* parsePositiveSafeInt(
    operation,
    'created_at_ms',
    decoded.created_at_ms,
  )
  const terminatedAtMs =
    decoded.terminated_at_ms === null
      ? undefined
      : yield* parsePositiveSafeInt(
          operation,
          'terminated_at_ms',
          decoded.terminated_at_ms,
        )
  return {
    sessionId: decoded.session_id,
    organizationId: decoded.organization_id,
    principalId: decoded.principal_id,
    principalForgeLogin: decoded.principal_forge_login,
    agentActorId: decoded.agent_actor_id,
    status: decoded.status,
    createdAtMs,
    ...(terminatedAtMs !== undefined ? { terminatedAtMs } : {}),
  } satisfies McpSessionRecord
})

const decodeGrantRow = Effect.fnUntraced(function* (
  operation: string,
  row: unknown,
) {
  const decoded = yield* Schema.decodeUnknownEffect(DelegatedGrantRow)(
    row,
  ).pipe(Effect.mapError((cause) => persistenceError(operation, cause)))
  const createdAtMs = yield* parsePositiveSafeInt(
    operation,
    'created_at_ms',
    decoded.created_at_ms,
  )
  const expiresAtMs = yield* parsePositiveSafeInt(
    operation,
    'expires_at_ms',
    decoded.expires_at_ms,
  )
  const revokedAtMs =
    decoded.revoked_at_ms === null
      ? undefined
      : yield* parsePositiveSafeInt(
          operation,
          'revoked_at_ms',
          decoded.revoked_at_ms,
        )
  return {
    grantId: decoded.grant_id,
    organizationId: decoded.organization_id,
    repositoryId: decoded.repository_id,
    humanDelegatorId: decoded.human_delegator_id,
    humanDelegatorForgeLogin: decoded.human_delegator_forge_login,
    agentActorId: decoded.agent_actor_id,
    sessionId: decoded.session_id,
    allowedFields: decoded.allowed_fields,
    scope: decoded.scope,
    status: decoded.status,
    createdAtMs,
    expiresAtMs,
    ...(revokedAtMs !== undefined ? { revokedAtMs } : {}),
    ...(decoded.revoked_by !== null ? { revokedBy: decoded.revoked_by } : {}),
  } satisfies DelegatedMcpGrant
})

const decodeProposalVersionRow = Effect.fnUntraced(function* (
  operation: string,
  row: unknown,
) {
  const decoded = yield* Schema.decodeUnknownEffect(ProposalVersionRow)(
    row,
  ).pipe(Effect.mapError((cause) => persistenceError(operation, cause)))
  const updatedAtMs = yield* parsePositiveSafeInt(
    operation,
    'updated_at_ms',
    decoded.updated_at_ms,
  )
  return {
    attemptId: decoded.attempt_id,
    organizationId: decoded.organization_id,
    repositoryId: decoded.repository_id,
    currentVersion: decoded.current_version,
    configVersion: decoded.config_version,
    configSnapshot: decoded.config_snapshot,
    updatedAtMs,
  } satisfies AttemptProposalVersionRecord
})

const decodeConfigRow = Effect.fnUntraced(function* (
  operation: string,
  row: unknown,
) {
  const decoded = yield* Schema.decodeUnknownEffect(RepositoryConfigRow)(
    row,
  ).pipe(Effect.mapError((cause) => persistenceError(operation, cause)))
  const updatedAtMs = yield* parsePositiveSafeInt(
    operation,
    'updated_at_ms',
    decoded.updated_at_ms,
  )
  return {
    repositoryId: decoded.repository_id,
    organizationId: decoded.organization_id,
    version: decoded.version,
    values: decoded.config_values,
    updatedBy: decoded.updated_by_attribution,
    updatedAtMs,
  } satisfies RepositoryConfigRecord
})

const decodeAuditEventRow = Effect.fnUntraced(function* (
  operation: string,
  row: unknown,
) {
  const decoded = yield* Schema.decodeUnknownEffect(AuditEventRow)(row).pipe(
    Effect.mapError((cause) => persistenceError(operation, cause)),
  )
  const createdAtMs = yield* parsePositiveSafeInt(
    operation,
    'created_at_ms',
    decoded.created_at_ms,
  )
  return {
    eventId: decoded.event_id,
    organizationId: decoded.organization_id,
    repositoryId: decoded.repository_id,
    action: decoded.action,
    ...(decoded.attempt_id !== null ? { attemptId: decoded.attempt_id } : {}),
    ...(decoded.proposal_version !== null
      ? { proposalVersion: decoded.proposal_version }
      : {}),
    attribution: decoded.attribution,
    ...(decoded.grant_id !== null ? { grantId: decoded.grant_id } : {}),
    ...(decoded.before_config_version !== null
      ? { beforeConfigVersion: decoded.before_config_version }
      : {}),
    ...(decoded.after_config_version !== null
      ? { afterConfigVersion: decoded.after_config_version }
      : {}),
    createdAtMs,
  } satisfies AuthorityAuditEvent
})

const decodeDecisionRow = Effect.fnUntraced(function* (
  operation: string,
  row: unknown,
) {
  const decoded = yield* Schema.decodeUnknownEffect(DecisionRow)(row).pipe(
    Effect.mapError((cause) => persistenceError(operation, cause)),
  )
  return {
    id: decoded.id,
    attemptId: decoded.attempt_id,
    proposalVersion: decoded.proposal_version,
    kind: decoded.kind,
    actorId: decoded.actor_id,
  } satisfies AcceptanceDecision
})

export const PostgresAuthorityStoreLayer = Layer.effect(
  AuthorityStore,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    return AuthorityStore.of({
      createMcpSession: Effect.fn('AuthorityStorePg.createMcpSession')(
        function* (input) {
          yield* Effect.annotateCurrentSpan({
            sessionId: input.sessionId,
            organizationId: input.organizationId,
          })
          const rows = yield* sql`
            INSERT INTO mcp_sessions (
              session_id,
              organization_id,
              principal_id,
              principal_forge_login,
              agent_actor_id,
              status,
              created_at_ms
            )
            VALUES (
              ${input.sessionId},
              ${input.organizationId},
              ${input.principalId},
              ${input.principalForgeLogin},
              ${input.agentActorId},
              'active',
              ${input.createdAtMs}
            )
            ON CONFLICT (session_id) DO NOTHING
            RETURNING
              session_id,
              organization_id,
              principal_id,
              principal_forge_login,
              agent_actor_id,
              status,
              created_at_ms,
              terminated_at_ms
          `.pipe(
            Effect.mapError((cause) =>
              persistenceError('AuthorityStorePg.createMcpSession', cause),
            ),
          )
          if (rows.length === 0) {
            return yield* new PersistenceError({
              operation: 'AuthorityStorePg.createMcpSession',
              message: `MCP session "${input.sessionId}" already exists`,
            })
          }
          return yield* decodeSessionRow(
            'AuthorityStorePg.createMcpSession',
            rows[0],
          )
        },
      ),

      findMcpSession: Effect.fn('AuthorityStorePg.findMcpSession')(
        function* (sessionId) {
          const rows = yield* sql`
          SELECT
            session_id,
            organization_id,
            principal_id,
            principal_forge_login,
            agent_actor_id,
            status,
            created_at_ms,
            terminated_at_ms
          FROM mcp_sessions
          WHERE session_id = ${sessionId}
        `.pipe(
            Effect.mapError((cause) =>
              persistenceError('AuthorityStorePg.findMcpSession', cause),
            ),
          )
          if (rows.length === 0) return Option.none()
          return Option.some(
            yield* decodeSessionRow('AuthorityStorePg.findMcpSession', rows[0]),
          )
        },
      ),

      terminateMcpSessionWithAudit: Effect.fn(
        'AuthorityStorePg.terminateMcpSessionWithAudit',
      )(function* (input) {
        yield* Effect.annotateCurrentSpan({ sessionId: input.sessionId })
        const attributionJson = JSON.stringify(input.attribution)
        return yield* sql
          .withTransaction(
            Effect.gen(function* () {
              const sessionRows = yield* sql`
                UPDATE mcp_sessions
                SET status = 'terminated',
                    terminated_at_ms = COALESCE(
                      terminated_at_ms,
                      GREATEST(created_at_ms, ${input.terminatedAtMs})
                    )
                WHERE session_id = ${input.sessionId}
                RETURNING
                  session_id,
                  organization_id,
                  principal_id,
                  principal_forge_login,
                  agent_actor_id,
                  status,
                  created_at_ms,
                  terminated_at_ms
              `
              if (sessionRows.length === 0) {
                return {
                  session: Option.none<McpSessionRecord>(),
                  expiredGrantCount: 0,
                }
              }
              const session = yield* decodeSessionRow(
                'AuthorityStorePg.terminateMcpSessionWithAudit',
                sessionRows[0],
              )
              const expiredRows = yield* sql`
                UPDATE delegated_mcp_grants
                SET status = 'expired'
                WHERE session_id = ${input.sessionId}
                  AND status = 'active'
                RETURNING repository_id
              `
              const expiredRepos = yield* Effect.forEach(expiredRows, (row) =>
                Schema.decodeUnknownEffect(ExpiredGrantRepoRow)(row).pipe(
                  Effect.map((r) => r.repository_id),
                  Effect.mapError((cause) =>
                    persistenceError(
                      'AuthorityStorePg.terminateMcpSessionWithAudit',
                      cause,
                    ),
                  ),
                ),
              )
              const uniqueRepos = [...new Set(expiredRepos)]
              let idx = 0
              for (const repoId of uniqueRepos) {
                idx += 1
                const eventId = AuditEventId.make(
                  `${input.auditEventIdPrefix}-${idx}`.slice(0, 128),
                )
                yield* sql`
                  INSERT INTO authority_audit_events (
                    event_id,
                    organization_id,
                    repository_key,
                    repository_id,
                    action,
                    attribution,
                    created_at_ms
                  )
                  VALUES (
                    ${eventId},
                    ${session.organizationId},
                    ${normalizeRepositoryKey(repoId)},
                    ${repoId},
                    'mcp_session.terminated',
                    ${attributionJson}::jsonb,
                    ${input.terminatedAtMs}
                  )
                `
              }
              return {
                session: Option.some(session),
                expiredGrantCount: expiredRows.length,
              }
            }),
          )
          .pipe(
            Effect.catchTag('SqlError', (cause) =>
              Effect.fail(
                persistenceError(
                  'AuthorityStorePg.terminateMcpSessionWithAudit',
                  cause,
                ),
              ),
            ),
          )
      }),

      issueDelegatedGrantWithAudit: Effect.fn(
        'AuthorityStorePg.issueDelegatedGrantWithAudit',
      )(function* (input) {
        yield* Effect.annotateCurrentSpan({
          grantId: input.grantId,
          sessionId: input.sessionId,
          repositoryId: input.repositoryId,
        })
        const allowedFieldsJson = JSON.stringify(input.allowedFields)
        const attributionJson = JSON.stringify(input.attribution)
        const repoKey = normalizeRepositoryKey(input.repositoryId)

        return yield* sql
          .withTransaction(
            Effect.gen(function* () {
              // Lock the session row so concurrent termination cannot race with grant insertion
              const sessionRows = yield* sql`
                SELECT
                  session_id,
                  organization_id,
                  principal_id,
                  principal_forge_login,
                  agent_actor_id,
                  status,
                  created_at_ms,
                  terminated_at_ms
                FROM mcp_sessions
                WHERE session_id = ${input.sessionId}
                FOR SHARE
              `
              if (sessionRows.length === 0) {
                return yield* new McpAuthorizationError({
                  code: 'session_terminated',
                  reason: `MCP session "${input.sessionId}" does not exist`,
                })
              }
              const session = yield* decodeSessionRow(
                'AuthorityStorePg.issueDelegatedGrantWithAudit',
                sessionRows[0],
              )
              if (session.status !== 'active') {
                return yield* new McpAuthorizationError({
                  code: 'session_terminated',
                  reason: `MCP session "${input.sessionId}" is already terminated`,
                })
              }
              if (
                session.principalId !== input.humanDelegatorId ||
                session.organizationId !== input.organizationId
              ) {
                return yield* new McpAuthorizationError({
                  code: 'wrong_actor',
                  reason: `MCP session "${input.sessionId}" does not belong to human principal "${input.humanDelegatorId}"`,
                })
              }
              if (session.agentActorId !== input.agentActorId) {
                return yield* new McpAuthorizationError({
                  code: 'wrong_actor',
                  reason: `MCP session "${input.sessionId}" is bound to agent "${session.agentActorId}", not "${input.agentActorId}"`,
                })
              }

              const rows = yield* sql`
                INSERT INTO delegated_mcp_grants (
                  grant_id,
                  organization_id,
                  repository_key,
                  repository_id,
                  human_delegator_id,
                  human_delegator_forge_login,
                  agent_actor_id,
                  session_id,
                  allowed_fields,
                  scope,
                  status,
                  created_at_ms,
                  expires_at_ms
                )
                VALUES (
                  ${input.grantId},
                  ${input.organizationId},
                  ${repoKey},
                  ${input.repositoryId},
                  ${input.humanDelegatorId},
                  ${input.humanDelegatorForgeLogin},
                  ${input.agentActorId},
                  ${input.sessionId},
                  ${allowedFieldsJson}::jsonb,
                  'session',
                  'active',
                  ${input.createdAtMs},
                  ${input.expiresAtMs}
                )
                ON CONFLICT (grant_id) DO NOTHING
                RETURNING
                  grant_id,
                  organization_id,
                  repository_id,
                  human_delegator_id,
                  human_delegator_forge_login,
                  agent_actor_id,
                  session_id,
                  allowed_fields,
                  scope,
                  status,
                  created_at_ms,
                  expires_at_ms,
                  revoked_at_ms,
                  revoked_by
              `
              if (rows.length === 0) {
                return yield* new PersistenceError({
                  operation: 'AuthorityStorePg.issueDelegatedGrantWithAudit',
                  message: `Delegated MCP grant "${input.grantId}" already exists`,
                })
              }
              const grant = yield* decodeGrantRow(
                'AuthorityStorePg.issueDelegatedGrantWithAudit',
                rows[0],
              )

              yield* sql`
                INSERT INTO authority_audit_events (
                  event_id,
                  organization_id,
                  repository_key,
                  repository_id,
                  action,
                  attribution,
                  grant_id,
                  created_at_ms
                )
                VALUES (
                  ${input.auditEventId},
                  ${input.organizationId},
                  ${repoKey},
                  ${input.repositoryId},
                  'mcp_grant.issued',
                  ${attributionJson}::jsonb,
                  ${grant.grantId},
                  ${input.createdAtMs}
                )
              `
              return grant
            }),
          )
          .pipe(
            Effect.catchTag('SqlError', (cause) =>
              Effect.fail(
                persistenceError(
                  'AuthorityStorePg.issueDelegatedGrantWithAudit',
                  cause,
                ),
              ),
            ),
          )
      }),

      findDelegatedGrant: Effect.fn('AuthorityStorePg.findDelegatedGrant')(
        function* (grantId) {
          const rows = yield* sql`
            SELECT
              grant_id,
              organization_id,
              repository_id,
              human_delegator_id,
              human_delegator_forge_login,
              agent_actor_id,
              session_id,
              allowed_fields,
              scope,
              status,
              created_at_ms,
              expires_at_ms,
              revoked_at_ms,
              revoked_by
            FROM delegated_mcp_grants
            WHERE grant_id = ${grantId}
          `.pipe(
            Effect.mapError((cause) =>
              persistenceError('AuthorityStorePg.findDelegatedGrant', cause),
            ),
          )
          if (rows.length === 0) return Option.none()
          return Option.some(
            yield* decodeGrantRow(
              'AuthorityStorePg.findDelegatedGrant',
              rows[0],
            ),
          )
        },
      ),

      revokeDelegatedGrantWithAudit: Effect.fn(
        'AuthorityStorePg.revokeDelegatedGrantWithAudit',
      )(function* (input) {
        yield* Effect.annotateCurrentSpan({ grantId: input.grantId })
        const attributionJson = JSON.stringify(input.attribution)
        return yield* sql
          .withTransaction(
            Effect.gen(function* () {
              const lockedRows = yield* sql`
                SELECT
                  grant_id,
                  organization_id,
                  repository_id,
                  human_delegator_id,
                  human_delegator_forge_login,
                  agent_actor_id,
                  session_id,
                  allowed_fields,
                  scope,
                  status,
                  created_at_ms,
                  expires_at_ms,
                  revoked_at_ms,
                  revoked_by
                FROM delegated_mcp_grants
                WHERE grant_id = ${input.grantId}
                  AND organization_id = ${input.organizationId}
                FOR UPDATE
              `
              if (lockedRows.length === 0) {
                return yield* new McpAuthorizationError({
                  code: 'missing_grant',
                  reason: `Delegated grant "${input.grantId}" was not found`,
                })
              }
              const existing = yield* decodeGrantRow(
                'AuthorityStorePg.revokeDelegatedGrantWithAudit',
                lockedRows[0],
              )
              if (existing.status === 'expired') {
                return yield* new McpAuthorizationError({
                  code: 'grant_expired',
                  reason: `Delegated grant "${input.grantId}" has already expired`,
                })
              }
              if (existing.status === 'revoked') {
                // Idempotent replay: already revoked — do NOT append duplicate audit events
                return existing
              }

              const updatedRows = yield* sql`
                UPDATE delegated_mcp_grants
                SET status = 'revoked',
                    revoked_at_ms = GREATEST(created_at_ms, ${input.revokedAtMs}),
                    revoked_by = ${input.revokedBy}
                WHERE grant_id = ${input.grantId}
                  AND status = 'active'
                RETURNING
                  grant_id,
                  organization_id,
                  repository_id,
                  human_delegator_id,
                  human_delegator_forge_login,
                  agent_actor_id,
                  session_id,
                  allowed_fields,
                  scope,
                  status,
                  created_at_ms,
                  expires_at_ms,
                  revoked_at_ms,
                  revoked_by
              `
              const revoked = yield* decodeGrantRow(
                'AuthorityStorePg.revokeDelegatedGrantWithAudit',
                updatedRows[0],
              )
              yield* sql`
                INSERT INTO authority_audit_events (
                  event_id,
                  organization_id,
                  repository_key,
                  repository_id,
                  action,
                  attribution,
                  grant_id,
                  created_at_ms
                )
                VALUES (
                  ${input.auditEventId},
                  ${revoked.organizationId},
                  ${normalizeRepositoryKey(revoked.repositoryId)},
                  ${revoked.repositoryId},
                  'mcp_grant.revoked',
                  ${attributionJson}::jsonb,
                  ${revoked.grantId},
                  ${input.revokedAtMs}
                )
              `
              return revoked
            }),
          )
          .pipe(
            Effect.catchTag('SqlError', (cause) =>
              Effect.fail(
                persistenceError(
                  'AuthorityStorePg.revokeDelegatedGrantWithAudit',
                  cause,
                ),
              ),
            ),
          )
      }),

      setCurrentProposalVersion: Effect.fn(
        'AuthorityStorePg.setCurrentProposalVersion',
      )(function* (input) {
        const repoKey = normalizeRepositoryKey(input.repositoryId)
        return yield* sql
          .withTransaction(
            Effect.gen(function* () {
              // Capture the repository's current config snapshot when an attempt is
              // first registered; subsequent proposal bumps preserve that frozen
              // attempt snapshot (ADR 0007 Q24/Q28).
              const configRows = yield* sql`
                SELECT
                  repository_id,
                  organization_id,
                  version,
                  config_values,
                  updated_by_attribution,
                  updated_at_ms
                FROM repository_configs
                WHERE organization_id = ${input.organizationId}
                  AND repository_key = ${repoKey}
              `
              let snapshotValues = DEFAULT_REPOSITORY_CONFIG_VALUES
              let snapshotVersion = ConfigVersion.make(1)
              if (configRows.length > 0) {
                const cfg = yield* decodeConfigRow(
                  'AuthorityStorePg.setCurrentProposalVersion',
                  configRows[0],
                )
                snapshotValues = cfg.values
                snapshotVersion = cfg.version
              }
              const snapshotJson = JSON.stringify(snapshotValues)

              const rows = yield* sql`
                INSERT INTO attempt_proposal_versions (
                  attempt_id,
                  organization_id,
                  repository_key,
                  repository_id,
                  current_version,
                  config_version,
                  config_snapshot,
                  updated_at_ms
                )
                VALUES (
                  ${input.attemptId},
                  ${input.organizationId},
                  ${repoKey},
                  ${input.repositoryId},
                  ${input.currentVersion},
                  ${snapshotVersion},
                  ${snapshotJson}::jsonb,
                  ${input.updatedAtMs}
                )
                ON CONFLICT (attempt_id) DO UPDATE
                SET current_version = EXCLUDED.current_version,
                    updated_at_ms = EXCLUDED.updated_at_ms
                WHERE attempt_proposal_versions.organization_id = EXCLUDED.organization_id
                  AND attempt_proposal_versions.repository_key = EXCLUDED.repository_key
                  AND EXCLUDED.current_version >= attempt_proposal_versions.current_version
                RETURNING
                  attempt_id,
                  organization_id,
                  repository_id,
                  current_version,
                  config_version,
                  config_snapshot,
                  updated_at_ms
              `
              if (rows.length === 0) {
                return yield* new PersistenceError({
                  operation: 'AuthorityStorePg.setCurrentProposalVersion',
                  message: `Refusing to downgrade or reassign proposal version for attempt "${input.attemptId}"`,
                })
              }
              return yield* decodeProposalVersionRow(
                'AuthorityStorePg.setCurrentProposalVersion',
                rows[0],
              )
            }),
          )
          .pipe(
            Effect.catchTag('SqlError', (cause) =>
              Effect.fail(
                persistenceError(
                  'AuthorityStorePg.setCurrentProposalVersion',
                  cause,
                ),
              ),
            ),
          )
      }),

      findCurrentProposalVersion: Effect.fn(
        'AuthorityStorePg.findCurrentProposalVersion',
      )(function* (attemptId) {
        const rows = yield* sql`
          SELECT
            attempt_id,
            organization_id,
            repository_id,
            current_version,
            config_version,
            config_snapshot,
            updated_at_ms
          FROM attempt_proposal_versions
          WHERE attempt_id = ${attemptId}
        `.pipe(
          Effect.mapError((cause) =>
            persistenceError(
              'AuthorityStorePg.findCurrentProposalVersion',
              cause,
            ),
          ),
        )
        if (rows.length === 0) return Option.none()
        return Option.some(
          yield* decodeProposalVersionRow(
            'AuthorityStorePg.findCurrentProposalVersion',
            rows[0],
          ),
        )
      }),

      recordDecisionAtomically: Effect.fn(
        'AuthorityStorePg.recordDecisionAtomically',
      )(function* (input) {
        yield* Effect.annotateCurrentSpan({
          attemptId: input.attemptId,
          repositoryId: input.repositoryId,
          proposalVersion: input.proposalVersion,
        })
        const repoKey = normalizeRepositoryKey(input.repositoryId)

        return yield* sql
          .withTransaction(
            Effect.gen(function* () {
              // 1. Lock the attempt's proposal version row so concurrent bumps
              //    cannot race past freshness verification
              const propRows = yield* sql`
                SELECT
                  attempt_id,
                  organization_id,
                  repository_id,
                  current_version,
                  config_version,
                  config_snapshot,
                  updated_at_ms
                FROM attempt_proposal_versions
                WHERE attempt_id = ${input.attemptId}
                FOR SHARE
              `
              if (propRows.length === 0) {
                return yield* new ProposalVersionNotFoundError({
                  attemptId: input.attemptId,
                  reason: `No registered proposal version found for attempt "${input.attemptId}"`,
                })
              }
              const proposal = yield* decodeProposalVersionRow(
                'AuthorityStorePg.recordDecisionAtomically',
                propRows[0],
              )
              if (
                proposal.organizationId !== input.organizationId ||
                normalizeRepositoryKey(proposal.repositoryId) !== repoKey
              ) {
                return yield* new ProposalVersionNotFoundError({
                  attemptId: input.attemptId,
                  reason: `Attempt "${input.attemptId}" does not belong to "${input.repositoryId}" in organization "${input.organizationId}"`,
                })
              }
              if (proposal.currentVersion !== input.proposalVersion) {
                return yield* new StaleProposalVersionError({
                  attemptId: input.attemptId,
                  expectedVersion: proposal.currentVersion,
                  actualVersion: input.proposalVersion,
                })
              }

              // 2. For automatic policy decisions, enforce the attempt's FROZEN
              //    configuration snapshot (ADR 0007 Q24/Q28) — live edits apply
              //    only to newly recorded attempts!
              let effectiveActorId = input.actorId
              let effectiveAttribution = input.attribution
              if (input.policyCheck !== undefined) {
                const field =
                  CATEGORY_TO_CONFIG_FIELD[input.policyCheck.category]
                const mode = proposal.configSnapshot[field]
                if (mode !== 'auto_policy') {
                  return yield* new ManualApprovalRequiredError({
                    repositoryId: input.repositoryId,
                    category: input.policyCheck.category,
                    reason: `Action category "${input.policyCheck.category}" on attempt "${input.attemptId}" requires manual approval under frozen config v${proposal.configVersion} (mode="${mode}")`,
                  })
                }
                effectiveActorId = ActorId.make(
                  `policy:${input.policyCheck.policyRuleId}@v${proposal.configVersion}`,
                )
                effectiveAttribution = {
                  _tag: 'PolicyRule',
                  policyRuleId: input.policyCheck.policyRuleId,
                  policyVersion: proposal.configVersion,
                  proposalVersion: input.proposalVersion,
                }
              }

              // 3. Insert decision idempotently (detecting replay vs conflict)
              const inserted = yield* sql`
                INSERT INTO acceptance_decisions (
                  id,
                  attempt_id,
                  proposal_version,
                  kind,
                  actor_id
                )
                VALUES (
                  ${input.decisionId},
                  ${input.attemptId},
                  ${input.proposalVersion},
                  ${input.kind},
                  ${effectiveActorId}
                )
                ON CONFLICT (attempt_id, proposal_version) DO NOTHING
                RETURNING id, attempt_id, proposal_version, kind, actor_id
              `

              if (inserted.length === 0) {
                const existingRows = yield* sql`
                  SELECT id, attempt_id, proposal_version, kind, actor_id
                  FROM acceptance_decisions
                  WHERE attempt_id = ${input.attemptId}
                    AND proposal_version = ${input.proposalVersion}
                `
                const existing = yield* decodeDecisionRow(
                  'AuthorityStorePg.recordDecisionAtomically',
                  existingRows[0],
                )
                if (
                  existing.kind === input.kind &&
                  existing.actorId === effectiveActorId
                ) {
                  // Idempotent replay: return existing decision without duplicating audit rows
                  return {
                    decision: existing,
                    auditEvent: Option.none<AuthorityAuditEvent>(),
                    frozenConfigVersion: proposal.configVersion,
                  }
                }
                return yield* new ConflictingDecisionError({
                  attemptId: input.attemptId,
                  proposalVersion: input.proposalVersion,
                  existingKind: existing.kind,
                  requestedKind: input.kind,
                  existingActorId: existing.actorId,
                  requestedActorId: effectiveActorId,
                })
              }

              const decision = yield* decodeDecisionRow(
                'AuthorityStorePg.recordDecisionAtomically',
                inserted[0],
              )

              const attributionJson = JSON.stringify(effectiveAttribution)
              const auditRows = yield* sql`
                INSERT INTO authority_audit_events (
                  event_id,
                  organization_id,
                  repository_key,
                  repository_id,
                  action,
                  attempt_id,
                  proposal_version,
                  attribution,
                  created_at_ms
                )
                VALUES (
                  ${input.auditEventId},
                  ${input.organizationId},
                  ${repoKey},
                  ${input.repositoryId},
                  ${input.action},
                  ${input.attemptId},
                  ${input.proposalVersion},
                  ${attributionJson}::jsonb,
                  ${input.createdAtMs}
                )
                RETURNING
                  event_id,
                  organization_id,
                  repository_id,
                  action,
                  attempt_id,
                  proposal_version,
                  attribution,
                  grant_id,
                  before_config_version,
                  after_config_version,
                  created_at_ms
              `
              const auditEvent = yield* decodeAuditEventRow(
                'AuthorityStorePg.recordDecisionAtomically',
                auditRows[0],
              )

              return {
                decision,
                auditEvent: Option.some(auditEvent),
                frozenConfigVersion: proposal.configVersion,
              }
            }),
          )
          .pipe(
            Effect.catchTag('SqlError', (cause) =>
              Effect.fail(
                persistenceError(
                  'AuthorityStorePg.recordDecisionAtomically',
                  cause,
                ),
              ),
            ),
          )
      }),

      getRepositoryConfig: Effect.fn('AuthorityStorePg.getRepositoryConfig')(
        function* (input) {
          const repoKey = normalizeRepositoryKey(input.repositoryId)
          const rows = yield* sql`
            SELECT
              repository_id,
              organization_id,
              version,
              config_values,
              updated_by_attribution,
              updated_at_ms
            FROM repository_configs
            WHERE organization_id = ${input.organizationId}
              AND repository_key = ${repoKey}
          `.pipe(
            Effect.mapError((cause) =>
              persistenceError('AuthorityStorePg.getRepositoryConfig', cause),
            ),
          )
          if (rows.length === 0) return Option.none()
          return Option.some(
            yield* decodeConfigRow(
              'AuthorityStorePg.getRepositoryConfig',
              rows[0],
            ),
          )
        },
      ),

      applyDelegatedConfigPatchWithAudit: Effect.fn(
        'AuthorityStorePg.applyDelegatedConfigPatchWithAudit',
      )(function* (input) {
        yield* Effect.annotateCurrentSpan({
          grantId: input.grantId,
          sessionId: input.sessionId,
          repositoryId: input.repositoryId,
        })
        const repoKey = normalizeRepositoryKey(input.repositoryId)
        const attributionJson = JSON.stringify(input.attribution)

        return yield* sql
          .withTransaction(
            Effect.gen(function* () {
              // 1. Lock session + grant (`FOR SHARE`) inside the commit
              //    transaction so concurrent revocation, session termination, or
              //    TTL expiry during upstream WorkOS/Forge calls fails closed!
              const sessionRows = yield* sql`
                SELECT
                  session_id,
                  organization_id,
                  principal_id,
                  principal_forge_login,
                  agent_actor_id,
                  status,
                  created_at_ms,
                  terminated_at_ms
                FROM mcp_sessions
                WHERE session_id = ${input.sessionId}
                FOR SHARE
              `
              if (sessionRows.length === 0) {
                return yield* new McpAuthorizationError({
                  code: 'session_terminated',
                  reason: `MCP session "${input.sessionId}" is not active`,
                })
              }
              const session = yield* decodeSessionRow(
                'AuthorityStorePg.applyDelegatedConfigPatchWithAudit',
                sessionRows[0],
              )
              if (session.status !== 'active') {
                return yield* new McpAuthorizationError({
                  code: 'session_terminated',
                  reason: `MCP session "${input.sessionId}" is no longer active`,
                })
              }

              const grantRows = yield* sql`
                SELECT
                  grant_id,
                  organization_id,
                  repository_id,
                  human_delegator_id,
                  human_delegator_forge_login,
                  agent_actor_id,
                  session_id,
                  allowed_fields,
                  scope,
                  status,
                  created_at_ms,
                  expires_at_ms,
                  revoked_at_ms,
                  revoked_by
                FROM delegated_mcp_grants
                WHERE grant_id = ${input.grantId}
                FOR SHARE
              `
              if (grantRows.length === 0) {
                return yield* new McpAuthorizationError({
                  code: 'missing_grant',
                  reason: `Delegated grant "${input.grantId}" does not exist`,
                })
              }
              const grant = yield* decodeGrantRow(
                'AuthorityStorePg.applyDelegatedConfigPatchWithAudit',
                grantRows[0],
              )
              if (
                grant.sessionId !== input.sessionId ||
                grant.agentActorId !== input.agentActorId ||
                grant.organizationId !== input.organizationId ||
                grant.humanDelegatorId !== input.humanDelegatorId
              ) {
                return yield* new McpAuthorizationError({
                  code: 'wrong_actor',
                  reason: `Delegated grant "${input.grantId}" does not match session/actor`,
                })
              }
              if (normalizeRepositoryKey(grant.repositoryId) !== repoKey) {
                return yield* new McpAuthorizationError({
                  code: 'wrong_repository',
                  reason: `Delegated grant "${input.grantId}" does not match "${input.repositoryId}"`,
                })
              }
              if (grant.status === 'revoked') {
                return yield* new McpAuthorizationError({
                  code: 'grant_revoked',
                  reason: `Delegated grant "${input.grantId}" was revoked`,
                })
              }
              if (
                grant.status === 'expired' ||
                input.updatedAtMs >= grant.expiresAtMs
              ) {
                return yield* new McpAuthorizationError({
                  code: 'grant_expired',
                  reason: `Delegated grant "${input.grantId}" has expired`,
                })
              }

              // 2. Lock repository_configs row (`FOR UPDATE`), verify exact
              //    expectedVersion, and merge partial patch inside the TX
              //    (prevents silent clobber of unpermitted fields!)
              const existingConfigRows = yield* sql`
                SELECT
                  repository_id,
                  organization_id,
                  version,
                  config_values,
                  updated_by_attribution,
                  updated_at_ms
                FROM repository_configs
                WHERE organization_id = ${input.organizationId}
                  AND repository_key = ${repoKey}
                FOR UPDATE
              `

              let config: RepositoryConfigRecord
              if (existingConfigRows.length === 0) {
                if (input.expectedVersion !== null) {
                  return yield* new StaleConfigVersionError({
                    repositoryId: input.repositoryId,
                    expectedVersion: input.expectedVersion,
                    actualVersion: null,
                  })
                }
                const nextValues = mergeConfigPatch(
                  DEFAULT_REPOSITORY_CONFIG_VALUES,
                  input.patch,
                )
                const valuesJson = JSON.stringify(nextValues)
                const insertedRows = yield* sql`
                  INSERT INTO repository_configs (
                    organization_id,
                    repository_key,
                    repository_id,
                    version,
                    config_values,
                    updated_by_attribution,
                    updated_at_ms
                  )
                  VALUES (
                    ${input.organizationId},
                    ${repoKey},
                    ${input.repositoryId},
                    1,
                    ${valuesJson}::jsonb,
                    ${attributionJson}::jsonb,
                    ${input.updatedAtMs}
                  )
                  ON CONFLICT (organization_id, repository_key) DO NOTHING
                  RETURNING
                    repository_id,
                    organization_id,
                    version,
                    config_values,
                    updated_by_attribution,
                    updated_at_ms
                `
                if (insertedRows.length === 0) {
                  return yield* new StaleConfigVersionError({
                    repositoryId: input.repositoryId,
                    expectedVersion: null,
                    actualVersion: ConfigVersion.make(1),
                  })
                }
                config = yield* decodeConfigRow(
                  'AuthorityStorePg.applyDelegatedConfigPatchWithAudit',
                  insertedRows[0],
                )
              } else {
                const existingConfig = yield* decodeConfigRow(
                  'AuthorityStorePg.applyDelegatedConfigPatchWithAudit',
                  existingConfigRows[0],
                )
                if (input.expectedVersion !== existingConfig.version) {
                  return yield* new StaleConfigVersionError({
                    repositoryId: input.repositoryId,
                    expectedVersion: input.expectedVersion,
                    actualVersion: existingConfig.version,
                  })
                }
                const nextValues = mergeConfigPatch(
                  existingConfig.values,
                  input.patch,
                )
                const valuesJson = JSON.stringify(nextValues)
                const updatedRows = yield* sql`
                  UPDATE repository_configs
                  SET version = version + 1,
                      config_values = ${valuesJson}::jsonb,
                      updated_by_attribution = ${attributionJson}::jsonb,
                      updated_at_ms = ${input.updatedAtMs}
                  WHERE organization_id = ${input.organizationId}
                    AND repository_key = ${repoKey}
                    AND version = ${existingConfig.version}
                  RETURNING
                    repository_id,
                    organization_id,
                    version,
                    config_values,
                    updated_by_attribution,
                    updated_at_ms
                `
                config = yield* decodeConfigRow(
                  'AuthorityStorePg.applyDelegatedConfigPatchWithAudit',
                  updatedRows[0],
                )
              }

              // 3. Atomically write audit event
              const auditRows = yield* sql`
                INSERT INTO authority_audit_events (
                  event_id,
                  organization_id,
                  repository_key,
                  repository_id,
                  action,
                  attribution,
                  grant_id,
                  before_config_version,
                  after_config_version,
                  created_at_ms
                )
                VALUES (
                  ${input.auditEventId},
                  ${input.organizationId},
                  ${repoKey},
                  ${input.repositoryId},
                  'repository_config.updated',
                  ${attributionJson}::jsonb,
                  ${input.grantId},
                  ${input.expectedVersion},
                  ${config.version},
                  ${input.updatedAtMs}
                )
                RETURNING
                  event_id,
                  organization_id,
                  repository_id,
                  action,
                  attempt_id,
                  proposal_version,
                  attribution,
                  grant_id,
                  before_config_version,
                  after_config_version,
                  created_at_ms
              `
              const auditEvent = yield* decodeAuditEventRow(
                'AuthorityStorePg.applyDelegatedConfigPatchWithAudit',
                auditRows[0],
              )

              // 4. Identify active attempts on this repository to notify both
              //    human & agent (ADR 0007 Q24: config changes apply at the next attempt)
              const activeAttemptRows = yield* sql`
                SELECT apv.attempt_id
                FROM attempt_proposal_versions apv
                JOIN verification_attempts va ON va.id = apv.attempt_id
                WHERE apv.organization_id = ${input.organizationId}
                  AND apv.repository_key = ${repoKey}
                  AND va.status IN ('pending', 'running')
                ORDER BY apv.attempt_id ASC
              `
              const activeAttemptNotices: ReadonlyArray<ActiveAttemptConfigNotice> =
                yield* Effect.forEach(activeAttemptRows, (row) =>
                  Schema.decodeUnknownEffect(ActiveAttemptIdRow)(row).pipe(
                    Effect.map((decoded): ActiveAttemptConfigNotice => ({
                      attemptId: decoded.attempt_id,
                      repositoryId: input.repositoryId,
                      configVersion: config.version,
                      message: `Repository configuration updated to v${config.version} while attempt "${decoded.attempt_id}" is active; changes will take effect on the next recorded attempt.`,
                    })),
                    Effect.mapError((cause) =>
                      persistenceError(
                        'AuthorityStorePg.applyDelegatedConfigPatchWithAudit',
                        cause,
                      ),
                    ),
                  ),
                )

              return { config, auditEvent, activeAttemptNotices }
            }),
          )
          .pipe(
            Effect.catchTag('SqlError', (cause) =>
              Effect.fail(
                persistenceError(
                  'AuthorityStorePg.applyDelegatedConfigPatchWithAudit',
                  cause,
                ),
              ),
            ),
          )
      }),

      listAuditEventsByRepository: Effect.fn(
        'AuthorityStorePg.listAuditEventsByRepository',
      )(function* (input) {
        const repoKey = normalizeRepositoryKey(input.repositoryId)
        const rawLimit = input.limit ?? DEFAULT_AUDIT_LIST_LIMIT
        const boundedLimit = Number.isFinite(rawLimit)
          ? Math.min(Math.max(1, Math.floor(rawLimit)), MAX_AUDIT_LIST_LIMIT)
          : DEFAULT_AUDIT_LIST_LIMIT

        const rows = yield* sql`
          SELECT
            event_id,
            organization_id,
            repository_id,
            action,
            attempt_id,
            proposal_version,
            attribution,
            grant_id,
            before_config_version,
            after_config_version,
            created_at_ms
          FROM authority_audit_events
          WHERE organization_id = ${input.organizationId}
            AND repository_key = ${repoKey}
          ORDER BY created_at_ms ASC, event_id ASC
          LIMIT ${boundedLimit}
        `.pipe(
          Effect.mapError((cause) =>
            persistenceError(
              'AuthorityStorePg.listAuditEventsByRepository',
              cause,
            ),
          ),
        )
        return yield* Effect.forEach(rows, (row) =>
          decodeAuditEventRow(
            'AuthorityStorePg.listAuditEventsByRepository',
            row,
          ),
        )
      }),
    })
  }),
)
