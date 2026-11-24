import { Context, Effect, Layer, Match, Option, Schema } from 'effect'
import { McpProtocol, McpServer, Tool, Toolkit } from 'effect/ai'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http'
import * as Redacted from 'effect/Redacted'
import {
  AcceptanceStore,
  type AuthenticatedMcpAgentCaller,
  AuthorityService,
  AuthorityStore,
} from '@patchplane/core'
import {
  ActionAttribution,
  ActiveAttemptConfigNotice,
  type AuthenticationError,
  AuthorityAuditEvent,
  ConfigVersion,
  DEFAULT_REPOSITORY_CONFIG_VALUES,
  McpGrantId,
  McpSessionId,
  ProposalVersion,
  RepositoryConfigValues,
  RepositoryId,
  sanitizeErrorMessage,
  VerificationAttemptId,
} from '@patchplane/domain'

/**
 * Request-level authenticated MCP agent caller provided strictly by
 * `PatchplaneMcpHttpAuthMiddleware` at the HTTP router boundary.
 * Every request (`initialize`, `tools/list`, `tools/call`, and `DELETE /mcp`)
 * requires a verified caller.
 */
export class CurrentMcpCaller extends Context.Service<
  CurrentMcpCaller,
  AuthenticatedMcpAgentCaller
>()('@patchplane/server/CurrentMcpCaller') {}

/**
 * Server-side token authenticator for MCP HTTP requests.
 */
export interface McpCallerAuthenticatorService {
  readonly authenticate: (input: {
    readonly bearerToken: Redacted.Redacted
    readonly sessionId?: McpSessionId
  }) => Effect.Effect<AuthenticatedMcpAgentCaller, AuthenticationError>
}

export class McpCallerAuthenticator extends Context.Service<
  McpCallerAuthenticator,
  McpCallerAuthenticatorService
>()('@patchplane/server/McpCallerAuthenticator') {}

export const GetAttemptStatusTool = Tool.make('patchplane_get_attempt_status', {
  description:
    'Read the authoritative status and current proposal version for a verification attempt.',
  parameters: Schema.Struct({
    attemptId: VerificationAttemptId,
  }),
  success: Schema.Struct({
    attemptId: VerificationAttemptId,
    found: Schema.Boolean,
    status: Schema.optionalKey(Schema.String),
    generation: Schema.optionalKey(Schema.Int),
    repositoryId: Schema.optionalKey(RepositoryId),
    currentProposalVersion: Schema.optionalKey(ProposalVersion),
  }),
  failure: Schema.String,
  failureMode: 'return',
  dependencies: [CurrentMcpCaller],
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)

export const GetRepositoryConfigTool = Tool.make(
  'patchplane_get_repository_config',
  {
    description:
      'Read the current versioned approval and verification configuration for a repository.',
    parameters: Schema.Struct({
      repositoryId: RepositoryId,
    }),
    success: Schema.Struct({
      repositoryId: RepositoryId,
      version: Schema.NullOr(ConfigVersion),
      values: RepositoryConfigValues,
      updatedBy: Schema.NullOr(ActionAttribution),
    }),
    failure: Schema.String,
    failureMode: 'return',
    dependencies: [CurrentMcpCaller],
  },
)
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)

export const ListAuditEventsTool = Tool.make('patchplane_list_audit_events', {
  description:
    'List bounded, attributed authority and configuration audit events for a repository.',
  parameters: Schema.Struct({
    repositoryId: RepositoryId,
    limit: Schema.optionalKey(
      Schema.Int.check(
        Schema.isGreaterThanOrEqualTo(1),
        Schema.isLessThanOrEqualTo(500),
      ),
    ),
  }),
  success: Schema.Struct({
    repositoryId: RepositoryId,
    events: Schema.Array(AuthorityAuditEvent),
  }),
  failure: Schema.String,
  failureMode: 'return',
  dependencies: [CurrentMcpCaller],
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)

export const UpdateRepositoryConfigTool = Tool.make(
  'patchplane_update_repository_config',
  {
    description:
      'Apply a server-enforced, human-delegated configuration change for a repository using a session-scoped MCP grant. Changes take effect on the next recorded attempt.',
    parameters: Schema.Struct({
      repositoryId: RepositoryId,
      grantId: McpGrantId,
      expectedConfigVersion: Schema.NullOr(ConfigVersion),
      patch: Schema.Record(Schema.String, Schema.Unknown),
    }),
    success: Schema.Struct({
      repositoryId: RepositoryId,
      version: ConfigVersion,
      values: RepositoryConfigValues,
      attribution: ActionAttribution,
      appliesAtNextRecordedAttempt: Schema.Literal(true),
      activeAttemptNotices: Schema.Array(ActiveAttemptConfigNotice),
    }),
    failure: Schema.String,
    failureMode: 'return',
    dependencies: [CurrentMcpCaller],
  },
)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false)

export const PatchplaneMcpToolkit = Toolkit.make(
  GetAttemptStatusTool,
  GetRepositoryConfigTool,
  ListAuditEventsTool,
  UpdateRepositoryConfigTool,
)

const extractBearerToken = (
  headerValue: string | undefined,
): Redacted.Redacted | null => {
  if (headerValue === undefined) return null
  const match = /^Bearer\s+(\S+)$/i.exec(headerValue.trim())
  if (match === null || match[1] === undefined || match[1].length === 0) {
    return null
  }
  return Redacted.make(match[1])
}

const unauthorizedResponse = HttpServerResponse.jsonUnsafe(
  { error: 'Authentication failed' },
  { status: 401 },
)

const forbiddenResponse = HttpServerResponse.jsonUnsafe(
  { error: 'Forbidden' },
  { status: 403 },
)

/**
 * Router-level HTTP guard around the `/mcp` endpoint:
 * - Authenticates EVERY HTTP request (`initialize`, `tools/list`, `tools/call`,
 *   and `DELETE /mcp`) via `McpCallerAuthenticator` (generic external `401`,
 *   sanitized server-side log).
 * - Rejects mismatched `x-patchplane-session-id` header claims.
 * - On authenticated `DELETE /mcp`, atomically terminates the caller's
 *   Patchplane MCP session and expires every active session-scoped grant in
 *   Postgres before completing HTTP session termination.
 */
export const PatchplaneMcpHttpAuthMiddleware = HttpRouter.middleware<{
  provides: CurrentMcpCaller
}>()(
  Effect.gen(function* () {
    const authenticator = yield* McpCallerAuthenticator
    const authorityService = yield* AuthorityService

    return (effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const bearerToken = extractBearerToken(request.headers.authorization)
        if (bearerToken === null) {
          return unauthorizedResponse
        }

        const headerSessionRaw = request.headers['x-patchplane-session-id']
        let requestedSessionId: McpSessionId | undefined
        if (headerSessionRaw !== undefined && headerSessionRaw.length > 0) {
          const decodedOpt = yield* Schema.decodeEffect(McpSessionId)(
            headerSessionRaw,
          ).pipe(
            Effect.asSome,
            Effect.catch(() => Effect.succeedNone),
          )
          if (Option.isNone(decodedOpt)) {
            return unauthorizedResponse
          }
          requestedSessionId = decodedOpt.value
        }

        const callerOpt = yield* authenticator
          .authenticate({
            bearerToken,
            ...(requestedSessionId !== undefined
              ? { sessionId: requestedSessionId }
              : {}),
          })
          .pipe(
            Effect.asSome,
            Effect.catch((err) =>
              Effect.logWarning('MCP request authentication rejected', {
                reason: sanitizeErrorMessage(err.reason),
              }).pipe(Effect.as(Option.none<AuthenticatedMcpAgentCaller>())),
            ),
          )
        if (Option.isNone(callerOpt)) {
          return unauthorizedResponse
        }
        const caller = callerOpt.value
        if (
          requestedSessionId !== undefined &&
          requestedSessionId !== caller.sessionId
        ) {
          return forbiddenResponse
        }

        yield* Effect.annotateCurrentSpan({
          mcpSessionId: caller.sessionId,
          agentActorId: caller.agentActorId,
          organizationId: caller.organizationId,
        })

        // On authenticated DELETE /mcp, terminate the Patchplane DB session and
        // automatically expire every active session-scoped grant in Postgres.
        if (request.method === 'DELETE') {
          const terminated = yield* authorityService
            .terminateMcpSession({
              caller: {
                _tag: 'AuthenticatedMcpSession',
                caller,
              },
              sessionId: caller.sessionId,
            })
            .pipe(
              Effect.as(true),
              Effect.catch((err) =>
                Effect.logWarning('MCP DELETE session termination failed', {
                  sessionId: caller.sessionId,
                  reason: sanitizeErrorMessage(err),
                }).pipe(Effect.as(false)),
              ),
            )
          if (!terminated) {
            return forbiddenResponse
          }
        }

        return yield* Effect.provideService(effect, CurrentMcpCaller, caller)
      })
  }),
)

const formatReadAccessError = (
  err:
    | import('@patchplane/domain').McpAuthorizationError
    | import('@patchplane/domain').RepositoryAuthorityError
    | import('@patchplane/domain').AuthenticationError
    | import('@patchplane/domain').ForgeAdapterError
    | import('@patchplane/domain').PersistenceError,
): string =>
  Match.value(err).pipe(
    Match.tag('McpAuthorizationError', (e) => `${e.code}: ${e.reason}`),
    Match.tag(
      'RepositoryAuthorityError',
      (e) => `repository_authority_denied: ${e.reason}`,
    ),
    Match.tag(
      'AuthenticationError',
      (e) => `authentication_error: ${e.reason}`,
    ),
    Match.tag('ForgeAdapterError', (e) => `forge_error: ${e.message}`),
    Match.tag('PersistenceError', (e) => `persistence_error: ${e.message}`),
    Match.exhaustive,
  )

const PatchplaneMcpToolHandlersLayer = PatchplaneMcpToolkit.toLayer(
  Effect.gen(function* () {
    const acceptanceStore = yield* AcceptanceStore
    const authorityStore = yield* AuthorityStore
    const authorityService = yield* AuthorityService

    return PatchplaneMcpToolkit.of({
      patchplane_get_attempt_status: Effect.fn(
        'PatchplaneMcp.getAttemptStatus',
      )(function* ({ attemptId }) {
        const caller = yield* CurrentMcpCaller
        const { proposal } = yield* authorityService
          .verifyMcpAttemptReadAccess({ caller, attemptId })
          .pipe(Effect.mapError(formatReadAccessError))

        // Do not leak cross-tenant or unbound attempt existence
        if (Option.isNone(proposal)) {
          return {
            attemptId,
            found: false,
          }
        }

        const attemptOpt = yield* acceptanceStore
          .findAttemptById(attemptId)
          .pipe(
            Effect.asSome,
            Effect.catchTag('AttemptNotFoundError', () => Effect.succeedNone),
            Effect.mapError((err) => `persistence_error: ${err.message}`),
          )
        if (Option.isNone(attemptOpt)) {
          return {
            attemptId,
            found: false,
          }
        }
        return {
          attemptId,
          found: true,
          status: attemptOpt.value.status,
          generation: attemptOpt.value.generation,
          repositoryId: proposal.value.repositoryId,
          currentProposalVersion: proposal.value.currentVersion,
        }
      }),

      patchplane_get_repository_config: Effect.fn(
        'PatchplaneMcp.getRepositoryConfig',
      )(function* ({ repositoryId }) {
        const caller = yield* CurrentMcpCaller
        const session = yield* authorityService
          .verifyMcpReadAccess({ caller, repositoryId })
          .pipe(Effect.mapError(formatReadAccessError))

        const configOpt = yield* authorityStore
          .getRepositoryConfig({
            organizationId: session.organizationId,
            repositoryId,
          })
          .pipe(Effect.mapError((err) => `persistence_error: ${err.message}`))
        if (Option.isNone(configOpt)) {
          return {
            repositoryId,
            version: null,
            values: DEFAULT_REPOSITORY_CONFIG_VALUES,
            updatedBy: null,
          }
        }
        return {
          repositoryId,
          version: configOpt.value.version,
          values: configOpt.value.values,
          updatedBy: configOpt.value.updatedBy,
        }
      }),

      patchplane_list_audit_events: Effect.fn('PatchplaneMcp.listAuditEvents')(
        function* ({ repositoryId, limit }) {
          const caller = yield* CurrentMcpCaller
          const session = yield* authorityService
            .verifyMcpReadAccess({ caller, repositoryId })
            .pipe(Effect.mapError(formatReadAccessError))

          const events = yield* authorityStore
            .listAuditEventsByRepository({
              organizationId: session.organizationId,
              repositoryId,
              ...(limit !== undefined ? { limit } : {}),
            })
            .pipe(Effect.mapError((err) => `persistence_error: ${err.message}`))
          return {
            repositoryId,
            events,
          }
        },
      ),

      patchplane_update_repository_config: Effect.fn(
        'PatchplaneMcp.updateRepositoryConfig',
      )(function* ({ repositoryId, grantId, expectedConfigVersion, patch }) {
        const caller = yield* CurrentMcpCaller
        const updated = yield* authorityService
          .applyDelegatedConfigUpdate({
            caller,
            grantId,
            repositoryId,
            expectedConfigVersion,
            patch,
          })
          .pipe(
            Effect.mapError((err) =>
              Match.value(err).pipe(
                Match.tag(
                  'McpAuthorizationError',
                  (e) => `${e.code}: ${e.reason}`,
                ),
                Match.tag(
                  'RepositoryAuthorityError',
                  (e) => `repository_authority_denied: ${e.reason}`,
                ),
                Match.tag(
                  'StaleConfigVersionError',
                  (e) =>
                    `stale_config_version: expected ${e.expectedVersion ?? 'none'}, actual ${e.actualVersion ?? 'none'}`,
                ),
                Match.tag(
                  'AuthenticationError',
                  (e) => `authentication_error: ${e.reason}`,
                ),
                Match.tag(
                  'ForgeAdapterError',
                  (e) => `forge_error: ${e.message}`,
                ),
                Match.tag(
                  'PersistenceError',
                  (e) => `persistence_error: ${e.message}`,
                ),
                Match.exhaustive,
              ),
            ),
          )
        return {
          repositoryId: updated.config.repositoryId,
          version: updated.config.version,
          values: updated.config.values,
          attribution: updated.attribution,
          appliesAtNextRecordedAttempt: updated.appliesAtNextRecordedAttempt,
          activeAttemptNotices: updated.activeAttemptNotices,
        }
      }),
    })
  }),
)

const PatchplaneMcpRegistrationsLayer = McpServer.toolkit(
  PatchplaneMcpToolkit,
).pipe(Layer.provide(PatchplaneMcpToolHandlersLayer))

/**
 * Registers the authenticated, sessionful Patchplane MCP Streamable HTTP
 * endpoint at `path` on the active `HttpRouter`.
 *
 * Only sessionful `McpProtocol.v2025_11_25` is enabled so session-scoped
 * delegated grants cannot be bypassed via stateless transport calls, and
 * `PatchplaneMcpHttpAuthMiddleware` authenticates every HTTP method (including
 * `initialize`, `tools/list`, `tools/call`, and `DELETE /mcp`).
 */
export const makePatchplaneMcpHttpLayer = (path: `/${string}` = '/mcp') =>
  McpServer.layerHttp({
    name: 'patchplane-control-plane',
    version: '2.0.0',
    path,
    protocols: [McpProtocol.v2025_11_25],
    allowSessionTermination: true,
    registrations: PatchplaneMcpRegistrationsLayer,
  }).pipe(Layer.provide(PatchplaneMcpHttpAuthMiddleware.layer))
