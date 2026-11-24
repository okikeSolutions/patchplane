import { describe, expect, it } from '@effect/vitest'
import {
  Clock,
  Context,
  Data,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Queue,
  Schema,
  Stream,
} from 'effect'
import * as Digest from 'effect/crypto/Digest'
import * as Mac from 'effect/crypto/Mac'
import * as SecureRandom from 'effect/crypto/SecureRandom'
import {
  HttpClient,
  HttpClientError,
  HttpClientResponse,
  HttpRouter,
} from 'effect/http'
import * as Redacted from 'effect/Redacted'
import {
  CONTROL_PLANE_UNAVAILABLE,
  ControlPlaneHttpPlatformLayer,
  DecisionInboxEventBus,
  DecisionInboxEventBusLive,
  makeControlPlaneHttpLayer,
  McpCallerAuthenticator,
  PostgresDecisionInboxBackendLayer,
  UnconfiguredControlPlaneAuthLayer,
  WorkOsInboxCallerAuthenticatorLayer,
} from '../../apps/server/src/index'
import {
  DecisionInboxClient as WebInboxClient,
  makeDecisionInboxClientLayer,
} from '../../apps/web/src/index'
import {
  AcceptanceStore,
  AuthorityServiceLayer,
  AuthorityStore,
} from '../../packages/core/src/index'
import {
  ActorId,
  AuthenticationError,
  ChangeRequestId,
  ForgeUserLogin,
  GitCommitSha,
  HumanPrincipalId,
  McpSessionId,
  OrganizationId,
  ProposalVersion,
  RepositoryId,
  type RepositoryPermissionLevel,
  VerificationAttemptId,
  WorkOsSessionId,
} from '../../packages/domain/src/index'
import {
  makeGitHubAppForgeAdapterLayer,
  makeWorkOsAuthProviderLayer,
  PostgresAcceptanceStoreLayer,
  PostgresAuthorityStoreLayer,
} from '../../packages/plugins/src/index'
import { resetAndMigrateDatabase, TestPostgresSqlLayer } from './test-db'

class ControlPlaneHttpTestError extends Data.TaggedError(
  'ControlPlaneHttpTestError',
)<{
  readonly message: string
}> {}

const MacLayer = Mac.layerWebCrypto.pipe(
  Layer.provide(SecureRandom.layerWebCrypto),
)

const ORG_A = OrganizationId.make('org-control-plane-http')
const REPO_A = RepositoryId.make('okikeSolutions/patchplane')
const MAINTAINER_ID = HumanPrincipalId.make('human-cp-maintainer')
const MAINTAINER_LOGIN = ForgeUserLogin.make('cp-maintainer')
const READER_ID = HumanPrincipalId.make('human-cp-reader')
const READER_LOGIN = ForgeUserLogin.make('cp-reader')
const AGENT_ID = ActorId.make('agent:cp-verifier')
const MCP_SESSION_ID = McpSessionId.make('mcp-cp-session-1')
const ATTEMPT_1 = VerificationAttemptId.make('attempt-cp-http-1')
const CHANGE_REQUEST_1 = ChangeRequestId.make(
  'github:okikeSolutions/patchplane#14',
)

const MAINTAINER_TOKEN = 'workos-cp-maintainer-token'
const READER_TOKEN = 'workos-cp-reader-token'
const MCP_TOKEN = 'mcp-cp-session-token'

const HealthResponseSchema = Schema.fromJsonString(
  Schema.Struct({
    status: Schema.Literal('ok'),
    runtime: Schema.Literal('bun'),
    wokenAt: Schema.Int,
  }),
)

const JsonRpcResponseSchema = Schema.fromJsonString(
  Schema.Struct({
    jsonrpc: Schema.Literal('2.0'),
    id: Schema.Union([Schema.Int, Schema.String]),
    result: Schema.optionalKey(Schema.Unknown),
  }),
)

const CallToolResultSchema = Schema.Struct({
  isError: Schema.optionalKey(Schema.Boolean),
  content: Schema.Array(
    Schema.Struct({
      type: Schema.String,
      text: Schema.optionalKey(Schema.String),
    }),
  ),
  structuredContent: Schema.optionalKey(Schema.Unknown),
})

const AttemptStatusToolResultSchema = Schema.Struct({
  attemptId: VerificationAttemptId,
  found: Schema.Literal(true),
  status: Schema.String,
  repositoryId: RepositoryId,
  currentProposalVersion: ProposalVersion,
})

const AuditListToolResultSchema = Schema.Struct({
  repositoryId: RepositoryId,
  events: Schema.Array(
    Schema.Struct({
      action: Schema.String,
    }),
  ),
})

const makeWebHandlerHttpClient = (
  handler: (request: Request) => Promise<Response>,
): HttpClient.HttpClient =>
  HttpClient.make((request, url, signal) =>
    Effect.tryPromise({
      try: async () => {
        const headers = new Headers()
        for (const [key, value] of Object.entries(request.headers)) {
          headers.set(key, value)
        }
        let body: BodyInit | undefined
        if (request.body._tag === 'Uint8Array') {
          body = new Uint8Array(request.body.body)
        } else if (
          request.body._tag === 'Raw' &&
          typeof request.body.body === 'string'
        ) {
          body = request.body.body
        }
        const webRequest = new Request(url.toString(), {
          method: request.method,
          headers,
          ...(body !== undefined ? { body } : {}),
          signal,
        })
        const response = await handler(webRequest)
        return HttpClientResponse.fromWeb(request, response)
      },
      catch: (cause) =>
        new HttpClientError.HttpClientError({
          reason: new HttpClientError.TransportError({
            request,
            cause,
          }),
        }),
    }),
  )

const invokeWebHandler = (
  handler: (request: Request) => Promise<Response>,
  request: Request,
) =>
  Effect.tryPromise({
    try: async () => {
      const response = await handler(request)
      const text = await response.text()
      return {
        status: response.status,
        headers: response.headers,
        text,
      }
    },
    catch: (cause) =>
      new ControlPlaneHttpTestError({
        message: String(cause),
      }),
  })

describe('Unified V2 Control-Plane HTTP Router (single Postgres store)', () => {
  it.live(
    'serves /health, /api/v2/inbox/* (+ live SSE), and /mcp on one router backed by a single Postgres database',
    () =>
      Effect.gen(function* () {
        yield* resetAndMigrateDatabase

        const nowMs = yield* Clock.currentTimeMillis
        const futureExpiry = nowMs + 60 * 60 * 1000
        const repoPermissions = new Map<string, RepositoryPermissionLevel>([
          [MAINTAINER_LOGIN, 'maintain'],
          [READER_LOGIN, 'read'],
        ])

        const workOsLayer = makeWorkOsAuthProviderLayer({
          exchangeGitHubOAuthCode: () => Effect.fail('unused'),
          verifyAccessToken: (token) => {
            const raw = Redacted.value(token)
            if (raw === MAINTAINER_TOKEN) {
              return Effect.succeed({
                provider: 'GitHubOAuth',
                identity: {
                  principalId: MAINTAINER_ID,
                  workOsUserId: 'wos_cp_maintainer',
                  workOsSessionId: WorkOsSessionId.make(
                    'wos_sess_cp_maintainer',
                  ),
                  organizationId: ORG_A,
                  forgeUserLogin: MAINTAINER_LOGIN,
                  email: 'maintainer@patchplane.dev',
                  expiresAtMs: futureExpiry,
                },
              })
            }
            if (raw === READER_TOKEN) {
              return Effect.succeed({
                provider: 'GitHubOAuth',
                identity: {
                  principalId: READER_ID,
                  workOsUserId: 'wos_cp_reader',
                  workOsSessionId: WorkOsSessionId.make('wos_sess_cp_reader'),
                  organizationId: ORG_A,
                  forgeUserLogin: READER_LOGIN,
                  email: 'reader@patchplane.dev',
                  expiresAtMs: futureExpiry,
                },
              })
            }
            return Effect.fail('Unknown session token')
          },
          checkOrganizationMembership: ({ organizationId }) =>
            Effect.succeed(organizationId === ORG_A),
        }).pipe(Layer.provide(Digest.layerWebCrypto))

        const forgeLayer = makeGitHubAppForgeAdapterLayer({
          webhookSecret: Redacted.make('whsec_cp_http_test'),
          createInstallationToken: () =>
            Effect.succeed({
              installationId: 'gh-inst-7701',
              token: 'ghs_cp_http_test',
              expiresAtMs: futureExpiry,
            }),
          getCollaboratorPermission: ({ username }) =>
            Effect.succeed({
              installationId: 'gh-inst-7701',
              permission: repoPermissions.get(username) ?? 'none',
            }),
          getPullRequest: () =>
            Effect.succeed({
              headSha: GitCommitSha.make('a'.repeat(40)),
              isFork: false,
            }),
        }).pipe(Layer.provide(MacLayer))

        const mcpAuthLayer = Layer.succeed(
          McpCallerAuthenticator,
          McpCallerAuthenticator.of({
            authenticate: ({ bearerToken }) =>
              Redacted.value(bearerToken) === MCP_TOKEN
                ? Effect.succeed({
                    agentActorId: AGENT_ID,
                    sessionId: MCP_SESSION_ID,
                    organizationId: ORG_A,
                    humanPrincipalId: MAINTAINER_ID,
                  })
                : Effect.fail(
                    new AuthenticationError({ reason: 'Invalid MCP token' }),
                  ),
          }),
        )

        const sharedEventBusCtx = yield* Layer.build(DecisionInboxEventBusLive)
        const eventBus = Context.get(sharedEventBusCtx, DecisionInboxEventBus)

        const pgStoresLayer = Layer.mergeAll(
          PostgresAcceptanceStoreLayer,
          PostgresAuthorityStoreLayer,
        ).pipe(Layer.provideMerge(TestPostgresSqlLayer))

        const storeDepsLayer = Layer.mergeAll(
          pgStoresLayer,
          workOsLayer,
          forgeLayer,
        )

        const authorityLayer = AuthorityServiceLayer.pipe(
          Layer.provide(storeDepsLayer),
        )
        const inboxBackendLayer = PostgresDecisionInboxBackendLayer.pipe(
          Layer.provide(storeDepsLayer),
        )
        const inboxAuthLayer = WorkOsInboxCallerAuthenticatorLayer.pipe(
          Layer.provide(workOsLayer),
        )

        const controlPlaneHttpLayer = makeControlPlaneHttpLayer().pipe(
          Layer.provide(storeDepsLayer),
          Layer.provide(authorityLayer),
          Layer.provide(inboxBackendLayer),
          Layer.provide(inboxAuthLayer),
          Layer.provide(mcpAuthLayer),
          Layer.provide(Layer.succeed(DecisionInboxEventBus, eventBus)),
          Layer.provide(ControlPlaneHttpPlatformLayer),
        )

        // Seed one attempt, proposal version, and MCP session in the single Postgres store
        const seedResult = yield* Effect.gen(function* () {
          const acceptance = yield* AcceptanceStore
          const authorityStore = yield* AuthorityStore

          yield* acceptance.claimAttempt({
            attemptId: ATTEMPT_1,
            changeRequestId: CHANGE_REQUEST_1,
          })
          yield* authorityStore.setCurrentProposalVersion({
            attemptId: ATTEMPT_1,
            organizationId: ORG_A,
            repositoryId: REPO_A,
            currentVersion: ProposalVersion.make(1),
            updatedAtMs: nowMs,
          })
          yield* authorityStore.createMcpSession({
            sessionId: MCP_SESSION_ID,
            organizationId: ORG_A,
            principalId: MAINTAINER_ID,
            principalForgeLogin: MAINTAINER_LOGIN,
            agentActorId: AGENT_ID,
            createdAtMs: nowMs,
          })
          return true
        }).pipe(Effect.provide(pgStoresLayer))
        expect(seedResult).toBe(true)

        const webHandler = yield* Effect.acquireRelease(
          Effect.sync(() =>
            HttpRouter.toWebHandler(controlPlaneHttpLayer, {
              disableLogger: true,
            }),
          ),
          ({ dispose }) =>
            Effect.tryPromise({
              try: () => dispose(),
              catch: (cause) =>
                new ControlPlaneHttpTestError({ message: String(cause) }),
            }).pipe(Effect.ignore),
        )

        // 1. GET /health checks Postgres directly
        const healthRes = yield* invokeWebHandler(
          webHandler.handler,
          new Request('http://patchplane.local/health'),
        )
        expect(healthRes.status).toBe(200)
        const healthBody = yield* Schema.decodeEffect(HealthResponseSchema)(
          healthRes.text,
        )
        expect(healthBody.status).toBe('ok')
        expect(healthBody.runtime).toBe('bun')

        // 2. Decision Inbox REST + SSE via Foldkit WebInboxClient
        const makeClientLayer = (token: string) =>
          makeDecisionInboxClientLayer({
            baseUrl: 'http://patchplane.local',
            bearerToken: Redacted.make(token),
          }).pipe(
            Layer.provide(
              Layer.succeed(
                HttpClient.HttpClient,
                makeWebHandlerHttpClient((req) => webHandler.handler(req)),
              ),
            ),
          )

        const snapshot = yield* Effect.gen(function* () {
          const client = yield* WebInboxClient
          return yield* client.listInbox
        }).pipe(Effect.provide(makeClientLayer(MAINTAINER_TOKEN)))
        expect(snapshot.items).toHaveLength(1)
        expect(snapshot.items[0]?.attemptId).toBe(ATTEMPT_1)

        // Reader cannot submit decision (403)
        const readerDenied = yield* Effect.gen(function* () {
          const client = yield* WebInboxClient
          return yield* Effect.flip(
            client.submitDecision({
              attemptId: ATTEMPT_1,
              payload: {
                proposalVersion: ProposalVersion.make(1),
                kind: 'approve',
              },
            }),
          )
        }).pipe(Effect.provide(makeClientLayer(READER_TOKEN)))
        expect(readerDenied.code).toBe('forbidden')

        // Start SSE stream before submitting decision
        const sseQueue = yield* Queue.unbounded<string>()
        const snapshotReceived = yield* Deferred.make<void>()
        const decisionReceived = yield* Deferred.make<void>()

        const sseFiber = yield* Effect.gen(function* () {
          const client = yield* WebInboxClient
          const eventStream = yield* client.openEventStream
          yield* eventStream.pipe(
            Stream.runForEach((event) =>
              Effect.gen(function* () {
                yield* Queue.offer(sseQueue, event._tag)
                if (event._tag === 'InboxSnapshotEvent') {
                  yield* Deferred.succeed(snapshotReceived, undefined)
                } else if (event._tag === 'DecisionRecordedEvent') {
                  yield* Deferred.succeed(decisionReceived, undefined)
                }
              }),
            ),
          )
        }).pipe(
          Effect.provide(makeClientLayer(MAINTAINER_TOKEN)),
          Effect.forkScoped,
        )

        yield* Deferred.await(snapshotReceived)

        // Maintainer submits approval -> persisted in Postgres & broadcast via SSE
        const submitted = yield* Effect.gen(function* () {
          const client = yield* WebInboxClient
          return yield* client.submitDecision({
            attemptId: ATTEMPT_1,
            payload: {
              proposalVersion: ProposalVersion.make(1),
              kind: 'approve',
            },
          })
        }).pipe(Effect.provide(makeClientLayer(MAINTAINER_TOKEN)))
        expect(submitted.decision.kind).toBe('approve')

        yield* Deferred.await(decisionReceived)
        yield* Fiber.interrupt(sseFiber)

        // Conflicting decision on same proposal version -> 409 conflict from Postgres
        const conflict = yield* Effect.gen(function* () {
          const client = yield* WebInboxClient
          return yield* Effect.flip(
            client.submitDecision({
              attemptId: ATTEMPT_1,
              payload: {
                proposalVersion: ProposalVersion.make(1),
                kind: 'reject',
              },
            }),
          )
        }).pipe(Effect.provide(makeClientLayer(MAINTAINER_TOKEN)))
        expect(conflict.code).toBe('conflict')

        // 3. POST /mcp on the SAME router reads the attempt & recorded audit event from Postgres
        const mcpInit = yield* invokeWebHandler(
          webHandler.handler,
          new Request('http://patchplane.local/mcp', {
            method: 'POST',
            headers: {
              authorization: `Bearer ${MCP_TOKEN}`,
              'content-type': 'application/json',
              accept: 'application/json, text/event-stream',
              'mcp-protocol-version': '2025-11-25',
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'initialize',
              params: {
                protocolVersion: '2025-11-25',
                capabilities: {},
                clientInfo: { name: 'exit-gate-test', version: '1.0.0' },
              },
            }),
          }),
        )
        expect(mcpInit.status).toBe(200)
        const transportSessionId = mcpInit.headers.get('mcp-session-id')
        expect(transportSessionId).toBeTruthy()

        const mcpStatusRes = yield* invokeWebHandler(
          webHandler.handler,
          new Request('http://patchplane.local/mcp', {
            method: 'POST',
            headers: {
              authorization: `Bearer ${MCP_TOKEN}`,
              'content-type': 'application/json',
              accept: 'application/json, text/event-stream',
              'mcp-protocol-version': '2025-11-25',
              'mcp-session-id': transportSessionId ?? '',
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 2,
              method: 'tools/call',
              params: {
                name: 'patchplane_get_attempt_status',
                arguments: { attemptId: ATTEMPT_1 },
              },
            }),
          }),
        )
        expect(mcpStatusRes.status).toBe(200)
        const mcpStatusRpc = yield* Schema.decodeEffect(JsonRpcResponseSchema)(
          mcpStatusRes.text,
        )
        const mcpStatusCall = yield* Schema.decodeUnknownEffect(
          CallToolResultSchema,
        )(mcpStatusRpc.result)
        expect(mcpStatusCall.isError).not.toBe(true)
        const mcpStatusData = yield* Schema.decodeUnknownEffect(
          AttemptStatusToolResultSchema,
        )(mcpStatusCall.structuredContent)
        expect(mcpStatusData.attemptId).toBe(ATTEMPT_1)
        expect(mcpStatusData.repositoryId).toBe(REPO_A)

        const mcpAuditRes = yield* invokeWebHandler(
          webHandler.handler,
          new Request('http://patchplane.local/mcp', {
            method: 'POST',
            headers: {
              authorization: `Bearer ${MCP_TOKEN}`,
              'content-type': 'application/json',
              accept: 'application/json, text/event-stream',
              'mcp-protocol-version': '2025-11-25',
              'mcp-session-id': transportSessionId ?? '',
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 3,
              method: 'tools/call',
              params: {
                name: 'patchplane_list_audit_events',
                arguments: { repositoryId: REPO_A },
              },
            }),
          }),
        )
        expect(mcpAuditRes.status).toBe(200)
        const mcpAuditRpc = yield* Schema.decodeEffect(JsonRpcResponseSchema)(
          mcpAuditRes.text,
        )
        const mcpAuditCall = yield* Schema.decodeUnknownEffect(
          CallToolResultSchema,
        )(mcpAuditRpc.result)
        const mcpAuditData = yield* Schema.decodeUnknownEffect(
          AuditListToolResultSchema,
        )(mcpAuditCall.structuredContent)
        expect(
          mcpAuditData.events.some((e) => e.action === 'decision.recorded'),
        ).toBe(true)
      }).pipe(Effect.scoped, Effect.provide(TestPostgresSqlLayer)),
  )

  it.live(
    'fails closed on /api/v2/inbox/* and /mcp when UnconfiguredControlPlaneAuthLayer is active while still serving /health',
    () =>
      Effect.gen(function* () {
        yield* resetAndMigrateDatabase

        const storeLayer = Layer.mergeAll(
          PostgresAcceptanceStoreLayer,
          PostgresAuthorityStoreLayer,
        ).pipe(Layer.provideMerge(TestPostgresSqlLayer))

        const authorityLayer = AuthorityServiceLayer.pipe(
          Layer.provide(storeLayer),
          Layer.provide(UnconfiguredControlPlaneAuthLayer),
        )
        const inboxBackendLayer = PostgresDecisionInboxBackendLayer.pipe(
          Layer.provide(storeLayer),
          Layer.provide(UnconfiguredControlPlaneAuthLayer),
        )

        const httpLayer = makeControlPlaneHttpLayer().pipe(
          Layer.provide(storeLayer),
          Layer.provide(authorityLayer),
          Layer.provide(inboxBackendLayer),
          Layer.provide(DecisionInboxEventBusLive),
          Layer.provide(UnconfiguredControlPlaneAuthLayer),
          Layer.provide(ControlPlaneHttpPlatformLayer),
        )

        const webHandler = yield* Effect.acquireRelease(
          Effect.sync(() =>
            HttpRouter.toWebHandler(httpLayer, { disableLogger: true }),
          ),
          ({ dispose }) =>
            Effect.tryPromise({
              try: () => dispose(),
              catch: (cause) =>
                new ControlPlaneHttpTestError({ message: String(cause) }),
            }).pipe(Effect.ignore),
        )

        const healthRes = yield* invokeWebHandler(
          webHandler.handler,
          new Request('http://patchplane.local/health'),
        )
        expect(healthRes.status).toBe(200)

        const inboxRes = yield* invokeWebHandler(
          webHandler.handler,
          new Request('http://patchplane.local/api/v2/inbox', {
            headers: { authorization: 'Bearer forged-token' },
          }),
        )
        expect(inboxRes.status).toBe(401)

        const mcpRes = yield* invokeWebHandler(
          webHandler.handler,
          new Request('http://patchplane.local/mcp', {
            method: 'POST',
            headers: {
              authorization: 'Bearer forged-token',
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'initialize',
            }),
          }),
        )
        expect(mcpRes.status).toBe(401)

        const missingRes = yield* invokeWebHandler(
          webHandler.handler,
          new Request('http://patchplane.local/does-not-exist'),
        )
        expect(missingRes.status).toBe(404)
        expect(CONTROL_PLANE_UNAVAILABLE).toBe('control_plane_unavailable')
      }).pipe(Effect.scoped, Effect.provide(TestPostgresSqlLayer)),
  )
})
