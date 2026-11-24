import { Effect, FileSystem, Layer, Path } from 'effect'
import { Etag, HttpPlatform, HttpRouter, HttpServerResponse } from 'effect/http'
import { SqlClient } from 'effect/sql'
import { ForgeAdapter, WorkOsAuthProvider } from '@patchplane/core'
import {
  AuthenticationError,
  ForgeAdapterError,
  ForgeInstanceId,
  ForgeProviderId,
  ForgeWebhookVerificationError,
  sanitizeErrorMessage,
} from '@patchplane/domain'
import { InboxUnauthorizedError } from '@patchplane/contracts'
import { wakeControlPlane } from './control-plane-service'
import {
  DecisionInboxHttpLayer,
  InboxCallerAuthenticator,
} from './decision-inbox-api'
import {
  makePatchplaneMcpHttpLayer,
  McpCallerAuthenticator,
} from './mcp-server'

/** Stable public error code; causes stay in server logs, never in HTTP bodies. */
export const CONTROL_PLANE_UNAVAILABLE = 'control_plane_unavailable'

/**
 * Shared HTTP platform services required by `HttpApiBuilder` and `HttpRouter`
 * when serving requests in-process (Bun container or Web handler).
 */
export const ControlPlaneHttpPlatformLayer = Layer.mergeAll(
  Etag.layer,
  HttpPlatform.layer.pipe(Layer.provide(FileSystem.layerNoop({}))),
  FileSystem.layerNoop({}),
  Path.layer,
)

/**
 * `GET /health` route executing a live Postgres readiness check via
 * `wakeControlPlane()`. Captures `SqlClient` at router-build time so callers
 * never supply request-scoped DB context. Errors are logged with credentials
 * scrubbed and returned as an opaque `503` payload.
 */
export const ControlPlaneHealthRouteLayer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const healthHandler = wakeControlPlane().pipe(
      Effect.provideService(SqlClient.SqlClient, sql),
      Effect.map((woken) =>
        HttpServerResponse.jsonUnsafe({
          status: woken.ok ? 'ok' : 'degraded',
          runtime: 'bun',
          wokenAt: woken.wokenAt,
        }),
      ),
      Effect.catchTag('PersistenceError', (error) =>
        Effect.logError('ControlPlaneHttp.health failed', {
          operation: error.operation,
          message: sanitizeErrorMessage(error.message),
        }).pipe(
          Effect.as(
            HttpServerResponse.jsonUnsafe(
              {
                status: 'error',
                runtime: 'bun',
                error: CONTROL_PLANE_UNAVAILABLE,
              },
              { status: 503 },
            ),
          ),
        ),
      ),
      Effect.withSpan('ControlPlaneHttp.health'),
    )
    yield* router.add('GET', '/health', healthHandler)
  }),
)

/**
 * Composes the unified Patchplane V2 control-plane HTTP router:
 * - `GET /health` — Postgres single-store wake/readiness check
 * - `/api/v2/inbox/*` — Decision Inbox REST + per-org SSE `HttpApi`
 * - `/mcp` (configurable) — sessionful authenticated Patchplane MCP server
 */
export const makeControlPlaneHttpLayer = (options?: {
  readonly mcpPath?: `/${string}`
}) =>
  Layer.mergeAll(
    ControlPlaneHealthRouteLayer,
    DecisionInboxHttpLayer,
    makePatchplaneMcpHttpLayer(options?.mcpPath ?? '/mcp'),
  )

const UNCONFIGURED_FORGE_PROVIDER = ForgeProviderId.make('github')
const UNCONFIGURED_FORGE_INSTANCE = ForgeInstanceId.make('github.com')

/**
 * Fail-closed authentication and forge boundary used when live WorkOS / GitHub
 * App HTTP transports are not yet configured in the runtime container.
 *
 * Guarantees `/api/v2/inbox/*` and `/mcp` reject every caller with `401`
 * instead of bypassing authentication.
 */
export const UnconfiguredControlPlaneAuthLayer: Layer.Layer<
  | WorkOsAuthProvider
  | ForgeAdapter
  | InboxCallerAuthenticator
  | McpCallerAuthenticator
> = Layer.mergeAll(
  Layer.succeed(
    WorkOsAuthProvider,
    WorkOsAuthProvider.of({
      authenticateGitHubOAuthCallback: Effect.fn(
        'UnconfiguredWorkOsAuthProvider.authenticateGitHubOAuthCallback',
      )(function* () {
        return yield* new AuthenticationError({
          reason: 'WorkOS OAuth provider is not configured',
        })
      }),
      verifySessionToken: Effect.fn(
        'UnconfiguredWorkOsAuthProvider.verifySessionToken',
      )(function* () {
        return yield* new AuthenticationError({
          reason: 'WorkOS session verification is not configured',
        })
      }),
      verifyOrganizationMembership: Effect.fn(
        'UnconfiguredWorkOsAuthProvider.verifyOrganizationMembership',
      )(function* () {
        return yield* new AuthenticationError({
          reason: 'WorkOS organization verification is not configured',
        })
      }),
    }),
  ),
  Layer.succeed(
    ForgeAdapter,
    ForgeAdapter.of({
      provider: UNCONFIGURED_FORGE_PROVIDER,
      instanceId: UNCONFIGURED_FORGE_INSTANCE,
      capabilities: {
        supportsPullRequests: true,
        supportsWebhooks: true,
        supportsInstallationTokens: true,
        supportsRepositoryPermissions: true,
        supportsStatusChecks: true,
      },
      verifyWebhookSignature: Effect.fn(
        'UnconfiguredForgeAdapter.verifyWebhookSignature',
      )(function* () {
        return yield* new ForgeWebhookVerificationError({
          provider: UNCONFIGURED_FORGE_PROVIDER,
          reason: 'GitHub App adapter is not configured',
        })
      }),
      getInstallationToken: Effect.fn(
        'UnconfiguredForgeAdapter.getInstallationToken',
      )(function* () {
        return yield* new ForgeAdapterError({
          provider: UNCONFIGURED_FORGE_PROVIDER,
          operation: 'getInstallationToken',
          message: 'GitHub App adapter is not configured',
        })
      }),
      checkRepositoryAuthority: Effect.fn(
        'UnconfiguredForgeAdapter.checkRepositoryAuthority',
      )(function* () {
        return yield* new ForgeAdapterError({
          provider: UNCONFIGURED_FORGE_PROVIDER,
          operation: 'checkRepositoryAuthority',
          message: 'GitHub App adapter is not configured',
        })
      }),
      getPullRequestCandidate: Effect.fn(
        'UnconfiguredForgeAdapter.getPullRequestCandidate',
      )(function* () {
        return yield* new ForgeAdapterError({
          provider: UNCONFIGURED_FORGE_PROVIDER,
          operation: 'getPullRequestCandidate',
          message: 'GitHub App adapter is not configured',
        })
      }),
    }),
  ),
  Layer.succeed(
    InboxCallerAuthenticator,
    InboxCallerAuthenticator.of({
      authenticate: Effect.fn(
        'UnconfiguredInboxCallerAuthenticator.authenticate',
      )(function* () {
        return yield* new InboxUnauthorizedError({
          message: 'Authentication failed',
        })
      }),
    }),
  ),
  Layer.succeed(
    McpCallerAuthenticator,
    McpCallerAuthenticator.of({
      authenticate: Effect.fn(
        'UnconfiguredMcpCallerAuthenticator.authenticate',
      )(function* () {
        return yield* new AuthenticationError({
          reason: 'Control plane MCP authenticator is not configured',
        })
      }),
    }),
  ),
)
