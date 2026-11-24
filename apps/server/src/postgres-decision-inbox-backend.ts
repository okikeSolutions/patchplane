import { Clock, Effect, Layer, Match, Option, Schema } from 'effect'
import { SqlClient } from 'effect/sql'
import {
  AuthorityStore,
  ForgeAdapter,
  WorkOsAuthProvider,
} from '@patchplane/core'
import {
  type AcceptanceDecision,
  ActorId,
  AttemptGeneration,
  AttemptStatus,
  AuditEventId,
  canReadWithRepositoryPermission,
  ChangeRequestId,
  DecisionId,
  DecisionKind,
  EpochMillis,
  ProposalVersion,
  RepositoryId,
  sanitizeErrorMessage,
  VerificationAttemptId,
  type WorkOsAuthenticatedIdentity,
} from '@patchplane/domain'
import {
  type AttemptDetail,
  type AttemptSummary,
  InboxAttemptNotFoundError,
  InboxDecisionConflictError,
  InboxForbiddenError,
  InboxRevision,
  InboxServerError,
  InboxUnauthorizedError,
  type SubmitDecisionResponse,
} from '@patchplane/contracts'
import {
  DecisionInboxBackend,
  InboxCallerAuthenticator,
} from './decision-inbox-api'

const NonNegativeSafeIntInput = Schema.Union([
  Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  Schema.String.check(Schema.isPattern(/^\d+$/)),
  Schema.BigInt,
])

const InboxAttemptRow = Schema.Struct({
  attempt_id: VerificationAttemptId,
  change_request_id: ChangeRequestId,
  repository_id: RepositoryId,
  status: AttemptStatus,
  generation: AttemptGeneration,
  current_version: ProposalVersion,
  updated_at_ms: NonNegativeSafeIntInput,
  decision_id: Schema.NullOr(DecisionId),
  decision_kind: Schema.NullOr(DecisionKind),
  decision_actor_id: Schema.NullOr(ActorId),
})

const RevisionRow = Schema.Struct({
  revision: NonNegativeSafeIntInput,
})

const parseNonNegativeSafeInt = Effect.fnUntraced(function* (
  field: string,
  raw: typeof NonNegativeSafeIntInput.Type,
) {
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) {
    return yield* new InboxServerError({
      message: `Invalid non-negative integer in column "${field}"`,
    })
  }
  return value
})

const toInboxServerError = (cause: unknown) =>
  new InboxServerError({
    message: sanitizeErrorMessage(cause),
  })

const formatNextAction = (
  status: AttemptStatus,
  decisionKind: DecisionKind | null,
): string => {
  if (decisionKind !== null) {
    return `Recorded ${decisionKind}`
  }
  return Match.value(status).pipe(
    Match.when('passed', () => 'Ready for review'),
    Match.when('failed', () => 'Inspect verification failure'),
    Match.when('incomplete', () => 'Review incomplete checks'),
    Match.when('cancelled', () => 'Attempt cancelled'),
    Match.when('running', () => 'Verification running'),
    Match.when('pending', () => 'Queued for verification'),
    Match.exhaustive,
  )
}

const decodeAttemptSummary = Effect.fnUntraced(function* (
  row: typeof InboxAttemptRow.Type,
) {
  const updatedAtMs = yield* parseNonNegativeSafeInt(
    'updated_at_ms',
    row.updated_at_ms,
  )
  const decodedUpdatedAt = yield* Schema.decodeEffect(EpochMillis)(
    updatedAtMs,
  ).pipe(Effect.mapError(toInboxServerError))

  const summary: AttemptSummary = {
    attemptId: row.attempt_id,
    changeRequestId: row.change_request_id,
    repositoryId: row.repository_id,
    title: `${row.repository_id} · ${row.change_request_id}`,
    status: row.status,
    generation: row.generation,
    proposalVersion: row.current_version,
    nextAction: formatNextAction(row.status, row.decision_kind),
    updatedAtMs: decodedUpdatedAt,
  }
  return summary
})

const decodeAttemptDecision = (
  row: typeof InboxAttemptRow.Type,
): AcceptanceDecision | null => {
  if (
    row.decision_id === null ||
    row.decision_kind === null ||
    row.decision_actor_id === null
  ) {
    return null
  }
  return {
    id: row.decision_id,
    attemptId: row.attempt_id,
    proposalVersion: row.current_version,
    kind: row.decision_kind,
    actorId: row.decision_actor_id,
  }
}

/**
 * WorkOS-backed bearer authenticator for the Decision Inbox HTTP/SSE API.
 */
export const WorkOsInboxCallerAuthenticatorLayer: Layer.Layer<
  InboxCallerAuthenticator,
  never,
  WorkOsAuthProvider
> = Layer.effect(
  InboxCallerAuthenticator,
  Effect.gen(function* () {
    const workOs = yield* WorkOsAuthProvider
    return InboxCallerAuthenticator.of({
      authenticate: Effect.fn('WorkOsInboxCallerAuthenticator.authenticate')(
        function* (bearerToken) {
          return yield* workOs.verifySessionToken(bearerToken).pipe(
            Effect.catch((err) =>
              Effect.logWarning('Decision inbox authentication rejected', {
                reason: sanitizeErrorMessage(err.reason),
              }).pipe(
                Effect.andThen(
                  Effect.fail(
                    new InboxUnauthorizedError({
                      message: 'Authentication failed',
                    }),
                  ),
                ),
              ),
            ),
          )
        },
      ),
    })
  }),
)

/**
 * Single-store PostgreSQL implementation of `DecisionInboxBackend`.
 *
 * Reads verification attempts, proposal versions, and decisions from the shared
 * Postgres control-plane database, enforces WorkOS org scoping + GitHub App
 * per-repository authority, and records human acceptance decisions atomically
 * via `AuthorityStore.recordDecisionAtomically`.
 */
export const PostgresDecisionInboxBackendLayer: Layer.Layer<
  DecisionInboxBackend,
  never,
  SqlClient.SqlClient | AuthorityStore | ForgeAdapter
> = Layer.effect(
  DecisionInboxBackend,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const authorityStore = yield* AuthorityStore
    const forgeAdapter = yield* ForgeAdapter

    const loadOrganizationRevision = Effect.fn(
      'PostgresDecisionInboxBackend.loadOrganizationRevision',
    )(function* (
      organizationId: WorkOsAuthenticatedIdentity['organizationId'],
    ) {
      const rows = yield* sql`
        SELECT (
          (SELECT COUNT(*) FROM attempt_proposal_versions WHERE organization_id = ${organizationId})
          + (SELECT COUNT(*) FROM authority_audit_events WHERE organization_id = ${organizationId})
        ) AS revision
      `.pipe(Effect.mapError(toInboxServerError))

      const first = rows[0]
      if (first === undefined) {
        return InboxRevision.make(0)
      }
      const decoded = yield* Schema.decodeUnknownEffect(RevisionRow)(
        first,
      ).pipe(Effect.mapError(toInboxServerError))
      const revisionNum = yield* parseNonNegativeSafeInt(
        'revision',
        decoded.revision,
      )
      return yield* Schema.decodeEffect(InboxRevision)(revisionNum).pipe(
        Effect.mapError(toInboxServerError),
      )
    })

    const canReadRepository = Effect.fn(
      'PostgresDecisionInboxBackend.canReadRepository',
    )(function* ({
      caller,
      repositoryId,
    }: {
      readonly caller: WorkOsAuthenticatedIdentity
      readonly repositoryId: RepositoryId
    }) {
      const authority = yield* forgeAdapter.checkRepositoryAuthority({
        repositoryId,
        forgeUserLogin: caller.forgeUserLogin,
      })
      return canReadWithRepositoryPermission(authority.permission)
    }, Effect.mapError(toInboxServerError))

    const loadAttemptRowForOrg = Effect.fn(
      'PostgresDecisionInboxBackend.loadAttemptRowForOrg',
    )(function* ({
      organizationId,
      attemptId,
    }: {
      readonly organizationId: WorkOsAuthenticatedIdentity['organizationId']
      readonly attemptId: VerificationAttemptId
    }) {
      const rows = yield* sql`
          SELECT
            va.id AS attempt_id,
            va.change_request_id,
            apv.repository_id,
            va.status,
            va.generation,
            apv.current_version,
            apv.updated_at_ms,
            ad.id AS decision_id,
            ad.kind AS decision_kind,
            ad.actor_id AS decision_actor_id
          FROM verification_attempts va
          INNER JOIN attempt_proposal_versions apv
            ON apv.attempt_id = va.id
          LEFT JOIN acceptance_decisions ad
            ON ad.attempt_id = va.id
            AND ad.proposal_version = apv.current_version
          WHERE va.id = ${attemptId}
            AND apv.organization_id = ${organizationId}
          LIMIT 1
        `

      const first = rows[0]
      if (first === undefined) {
        return Option.none<typeof InboxAttemptRow.Type>()
      }
      const decoded = yield* Schema.decodeUnknownEffect(InboxAttemptRow)(first)
      return Option.some(decoded)
    }, Effect.mapError(toInboxServerError))

    return DecisionInboxBackend.of({
      canReadRepository,

      listInbox: Effect.fn('PostgresDecisionInboxBackend.listInbox')(
        function* (caller) {
          const rows = yield* sql`
          SELECT
            va.id AS attempt_id,
            va.change_request_id,
            apv.repository_id,
            va.status,
            va.generation,
            apv.current_version,
            apv.updated_at_ms,
            ad.id AS decision_id,
            ad.kind AS decision_kind,
            ad.actor_id AS decision_actor_id
          FROM verification_attempts va
          INNER JOIN attempt_proposal_versions apv
            ON apv.attempt_id = va.id
          LEFT JOIN acceptance_decisions ad
            ON ad.attempt_id = va.id
            AND ad.proposal_version = apv.current_version
          WHERE apv.organization_id = ${caller.organizationId}
          ORDER BY apv.updated_at_ms DESC, va.id ASC
        `.pipe(Effect.mapError(toInboxServerError))

          const decodedRows = yield* Schema.decodeUnknownEffect(
            Schema.Array(InboxAttemptRow),
          )(rows).pipe(Effect.mapError(toInboxServerError))

          const repoReadCache = new Map<RepositoryId, boolean>()
          const items: Array<AttemptSummary> = []
          for (const row of decodedRows) {
            let allowed = repoReadCache.get(row.repository_id)
            if (allowed === undefined) {
              allowed = yield* canReadRepository({
                caller,
                repositoryId: row.repository_id,
              })
              repoReadCache.set(row.repository_id, allowed)
            }
            if (!allowed) continue
            items.push(yield* decodeAttemptSummary(row))
          }

          const revision = yield* loadOrganizationRevision(
            caller.organizationId,
          )
          return { revision, items }
        },
      ),

      getAttemptDetail: Effect.fn(
        'PostgresDecisionInboxBackend.getAttemptDetail',
      )(function* ({ caller, attemptId }) {
        const rowOpt = yield* loadAttemptRowForOrg({
          organizationId: caller.organizationId,
          attemptId,
        })
        if (Option.isNone(rowOpt)) {
          return yield* new InboxAttemptNotFoundError({
            attemptId,
            message: `Attempt ${attemptId} was not found`,
          })
        }
        const row = rowOpt.value
        const allowed = yield* canReadRepository({
          caller,
          repositoryId: row.repository_id,
        })
        if (!allowed) {
          return yield* new InboxForbiddenError({
            message: 'Repository read permission required',
          })
        }

        const summary = yield* decodeAttemptSummary(row)
        const revision = yield* loadOrganizationRevision(caller.organizationId)
        const detail: AttemptDetail = {
          revision,
          summary,
          diffText: '',
          files: [],
          decision: decodeAttemptDecision(row),
        }
        return detail
      }),

      submitDecision: Effect.fn('PostgresDecisionInboxBackend.submitDecision')(
        function* ({ caller, attemptId, payload }) {
          const rowOpt = yield* loadAttemptRowForOrg({
            organizationId: caller.organizationId,
            attemptId,
          })
          if (Option.isNone(rowOpt)) {
            return yield* new InboxAttemptNotFoundError({
              attemptId,
              message: `Attempt ${attemptId} was not found`,
            })
          }
          const row = rowOpt.value

          const authority = yield* forgeAdapter
            .checkRepositoryAuthority({
              repositoryId: row.repository_id,
              forgeUserLogin: caller.forgeUserLogin,
            })
            .pipe(Effect.mapError(toInboxServerError))
          if (!authority.canApprove) {
            return yield* new InboxForbiddenError({
              message:
                'Repository write or maintainer permission required to record decisions',
            })
          }

          const nowMs = yield* Clock.currentTimeMillis
          const decisionId = yield* Effect.sync(() =>
            DecisionId.make(`dec-${nowMs}-${crypto.randomUUID()}`),
          )
          const auditEventId = yield* Effect.sync(() =>
            AuditEventId.make(
              `evt-inbox-decision-${nowMs}-${crypto.randomUUID()}`,
            ),
          )

          const recorded = yield* authorityStore
            .recordDecisionAtomically({
              decisionId,
              organizationId: caller.organizationId,
              repositoryId: row.repository_id,
              attemptId,
              proposalVersion: payload.proposalVersion,
              kind: payload.kind,
              actorId: ActorId.make(caller.principalId),
              action: 'decision.recorded',
              attribution: {
                _tag: 'HumanPrincipal',
                principalId: caller.principalId,
                organizationId: caller.organizationId,
                workOsSessionId: caller.workOsSessionId,
                forgeUserLogin: caller.forgeUserLogin,
              },
              auditEventId,
              createdAtMs: nowMs,
            })
            .pipe(
              Effect.mapError((err) =>
                Match.value(err).pipe(
                  Match.tag(
                    'ProposalVersionNotFoundError',
                    () =>
                      new InboxAttemptNotFoundError({
                        attemptId,
                        message: `Attempt ${attemptId} was not found`,
                      }),
                  ),
                  Match.tag(
                    'StaleProposalVersionError',
                    (e) =>
                      new InboxDecisionConflictError({
                        attemptId,
                        proposalVersion: payload.proposalVersion,
                        message: `Proposal version ${e.expectedVersion} is stale; current version is ${e.actualVersion}`,
                      }),
                  ),
                  Match.tag(
                    'ConflictingDecisionError',
                    (e) =>
                      new InboxDecisionConflictError({
                        attemptId,
                        proposalVersion: payload.proposalVersion,
                        message: `Proposal v${payload.proposalVersion} already has conflicting decision ${e.existingKind}`,
                      }),
                  ),
                  Match.tag(
                    'ManualApprovalRequiredError',
                    (e) =>
                      new InboxForbiddenError({
                        message: `Manual approval required for ${e.category}`,
                      }),
                  ),
                  Match.tag('PersistenceError', (e) => toInboxServerError(e)),
                  Match.exhaustive,
                ),
              ),
            )

          const baseSummary = yield* decodeAttemptSummary(row)
          const updatedAtMs = yield* Schema.decodeEffect(EpochMillis)(
            nowMs,
          ).pipe(Effect.mapError(toInboxServerError))
          const summary: AttemptSummary = {
            attemptId: baseSummary.attemptId,
            changeRequestId: baseSummary.changeRequestId,
            repositoryId: baseSummary.repositoryId,
            title: baseSummary.title,
            status: baseSummary.status,
            generation: baseSummary.generation,
            proposalVersion: baseSummary.proposalVersion,
            nextAction: formatNextAction(row.status, recorded.decision.kind),
            updatedAtMs,
          }
          const response: SubmitDecisionResponse = {
            decision: recorded.decision,
            summary,
          }
          return response
        },
      ),
    })
  }),
)
