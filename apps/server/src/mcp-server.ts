import { Context, Effect, Layer, Match, Option, Schema } from 'effect'
import { McpProtocol, McpSchema, McpServer, Tool, Toolkit } from 'effect/ai'
import * as Redacted from 'effect/Redacted'
import {
  AcceptanceStore,
  applyDelegatedConfigUpdate,
  type AuthenticatedMcpAgentCaller,
  AuthorityStore,
  ForgeAdapter,
  WorkOsAuthProvider,
} from '@patchplane/core'
import {
  ActionAttribution,
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
 * `PatchplaneMcpAuthMiddleware`. Tool handlers cannot execute without it.
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
    readonly sessionId: McpSessionId
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

export const ListAuditEventsTool = Tool.make('patchplane_list_audit_events', {
  description:
    'List attributed authority and configuration audit events for a repository.',
  parameters: Schema.Struct({
    repositoryId: RepositoryId,
  }),
  success: Schema.Struct({
    repositoryId: RepositoryId,
    events: Schema.Array(AuthorityAuditEvent),
  }),
  failure: Schema.String,
  failureMode: 'return',
  dependencies: [CurrentMcpCaller],
})

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
    }),
    failure: Schema.String,
    failureMode: 'return',
    dependencies: [CurrentMcpCaller],
  },
)

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

export const PatchplaneMcpAuthMiddleware = McpServer.middleware<{
  provides: CurrentMcpCaller
}>()(
  Effect.gen(function* () {
    const authenticator = yield* McpCallerAuthenticator

    return (effect, { headers, sessionId }) =>
      Effect.gen(function* () {
        const bearerToken = extractBearerToken(headers.authorization)
        if (bearerToken === null) {
          return yield* Effect.fail(
            new McpSchema.McpErrorBase({
              code: -32001,
              message: 'Missing or invalid Bearer authorization header',
            }),
          )
        }
        const rawSessionId =
          headers['x-patchplane-session-id'] ?? sessionId ?? ''
        const decodedSessionId = yield* Schema.decodeEffect(McpSessionId)(
          rawSessionId,
        ).pipe(
          Effect.mapError(
            () =>
              new McpSchema.McpErrorBase({
                code: -32001,
                message: 'Missing or invalid Patchplane MCP session header',
              }),
          ),
        )
        const caller = yield* authenticator
          .authenticate({
            bearerToken,
            sessionId: decodedSessionId,
          })
          .pipe(
            Effect.mapError(
              (err) =>
                new McpSchema.McpErrorBase({
                  code: -32001,
                  message: err.reason,
                }),
            ),
          )
        return yield* Effect.provideService(effect, CurrentMcpCaller, caller)
      })
  }),
)

const PatchplaneMcpToolHandlersLayer = PatchplaneMcpToolkit.toLayer(
  Effect.gen(function* () {
    const acceptanceStore = yield* AcceptanceStore
    const authorityStore = yield* AuthorityStore
    const workOsAuth = yield* WorkOsAuthProvider
    const forgeAdapter = yield* ForgeAdapter

    return PatchplaneMcpToolkit.of({
      patchplane_get_attempt_status: Effect.fn(
        'PatchplaneMcp.getAttemptStatus',
      )(function* ({ attemptId }) {
        yield* CurrentMcpCaller
        const attemptOpt = yield* acceptanceStore
          .findAttemptById(attemptId)
          .pipe(
            Effect.asSome,
            Effect.catchTag('AttemptNotFoundError', () => Effect.succeedNone),
            Effect.mapError((err) => sanitizeErrorMessage(err)),
          )
        const versionOpt = yield* authorityStore
          .findCurrentProposalVersion(attemptId)
          .pipe(Effect.mapError((err) => sanitizeErrorMessage(err)))
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
          ...(Option.isSome(versionOpt)
            ? {
                repositoryId: versionOpt.value.repositoryId,
                currentProposalVersion: versionOpt.value.currentVersion,
              }
            : {}),
        }
      }),

      patchplane_get_repository_config: Effect.fn(
        'PatchplaneMcp.getRepositoryConfig',
      )(function* ({ repositoryId }) {
        yield* CurrentMcpCaller
        const configOpt = yield* authorityStore
          .getRepositoryConfig(repositoryId)
          .pipe(Effect.mapError((err) => sanitizeErrorMessage(err)))
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
        function* ({ repositoryId }) {
          yield* CurrentMcpCaller
          const events = yield* authorityStore
            .listAuditEventsByRepository(repositoryId)
            .pipe(Effect.mapError((err) => sanitizeErrorMessage(err)))
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
        const updated = yield* applyDelegatedConfigUpdate({
          caller,
          grantId,
          repositoryId,
          expectedConfigVersion,
          patch,
        }).pipe(
          Effect.provideService(AuthorityStore, authorityStore),
          Effect.provideService(WorkOsAuthProvider, workOsAuth),
          Effect.provideService(ForgeAdapter, forgeAdapter),
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
                  `stale_config_version: expected ${e.expectedVersion}, actual ${e.actualVersion}`,
              ),
              Match.orElse((e) => sanitizeErrorMessage(e)),
            ),
          ),
        )
        return {
          repositoryId: updated.config.repositoryId,
          version: updated.config.version,
          values: updated.config.values,
          attribution: updated.attribution,
          appliesAtNextRecordedAttempt: updated.appliesAtNextRecordedAttempt,
        }
      }),
    })
  }),
)

const PatchplaneMcpRegistrationsLayer = McpServer.toolkit(
  PatchplaneMcpToolkit,
).pipe(
  Layer.provide(PatchplaneMcpAuthMiddleware.layer),
  Layer.provide(PatchplaneMcpToolHandlersLayer),
)

/**
 * Registers the authenticated Patchplane MCP Streamable HTTP endpoint at `/mcp`
 * on the active `HttpRouter`.
 */
export const makePatchplaneMcpHttpLayer = (path: `/${string}` = '/mcp') =>
  McpServer.layerHttp({
    name: 'patchplane-control-plane',
    version: '2.0.0',
    path,
    protocols: [McpProtocol.v2025_11_25, McpProtocol.v2026_07_28],
    allowSessionTermination: true,
    registrations: PatchplaneMcpRegistrationsLayer,
  })
