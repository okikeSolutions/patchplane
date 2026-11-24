import { describe, expect, it } from '@effect/vitest'
import { Data, Effect, Layer, Option, Schema } from 'effect'
import * as Mac from 'effect/crypto/Mac'
import * as SecureRandom from 'effect/crypto/SecureRandom'
import { HttpRouter } from 'effect/http'
import * as Redacted from 'effect/Redacted'
import { SqlClient } from 'effect/sql'
import {
  makePatchplaneMcpHttpLayer,
  McpCallerAuthenticator,
} from '../../apps/server/src/index'
import {
  AcceptanceStore,
  AuthorityStore,
  issueSessionScopedMcpGrant,
  recordHumanAcceptanceDecision,
  revokeDelegatedMcpGrant,
  terminateMcpSessionAndExpireGrants,
  WorkOsAuthProvider,
} from '../../packages/core/src/index'
import {
  ActorId,
  AuthenticationError,
  ChangeRequestId,
  ConfigVersion,
  DecisionId,
  ForgeUserLogin,
  GitCommitSha,
  HumanPrincipalId,
  McpGrantId,
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

class McpTestTransportError extends Data.TaggedError('McpTestTransportError')<{
  readonly message: string
}> {}

const MacLayer = Mac.layerWebCrypto.pipe(
  Layer.provide(SecureRandom.layerWebCrypto),
)

const ORG_ID = OrganizationId.make('org-okike-int')
const REPO_ID = RepositoryId.make('okikeSolutions/arbeo')
const OTHER_REPO_ID = RepositoryId.make('okikeSolutions/other')
const HUMAN_ID = HumanPrincipalId.make('human-ugo')
const HUMAN_LOGIN = ForgeUserLogin.make('okike-maintainer')
const READER_ID = HumanPrincipalId.make('human-reader')
const READER_LOGIN = ForgeUserLogin.make('okike-reader')
const AGENT_A = ActorId.make('agent:codex-a')
const AGENT_B = ActorId.make('agent:codex-b')
const SESSION_A = McpSessionId.make('mcp-session-a')
const SESSION_B = McpSessionId.make('mcp-session-b')
const ATTEMPT_ID = VerificationAttemptId.make('attempt-proof5-1')
const CHANGE_REQUEST_ID = ChangeRequestId.make('github:okikeSolutions/arbeo#55')

const JsonRpcResponseSchema = Schema.Struct({
  jsonrpc: Schema.Literal('2.0'),
  id: Schema.Union([Schema.Int, Schema.String]),
  result: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(
    Schema.Struct({
      code: Schema.Int,
      message: Schema.String,
    }),
  ),
})

const ToolListResultSchema = Schema.Struct({
  tools: Schema.Array(
    Schema.Struct({
      name: Schema.String,
    }),
  ),
})

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

const ConfigToolResultSchema = Schema.Struct({
  repositoryId: RepositoryId,
  version: ConfigVersion,
  values: Schema.Struct({
    'verification.max_wall_clock_minutes': Schema.Int,
  }),
  attribution: Schema.TaggedStruct('DelegatedAgent', {
    agentActorId: ActorId,
    humanDelegatorId: HumanPrincipalId,
    grantId: McpGrantId,
    sessionId: McpSessionId,
  }),
  appliesAtNextRecordedAttempt: Schema.Literal(true),
})

const AttemptStatusResultSchema = Schema.Struct({
  attemptId: VerificationAttemptId,
  found: Schema.Boolean,
  status: Schema.String,
  currentProposalVersion: ProposalVersion,
})

describe('V2 Stack Proof 5: WorkOS GitHub OAuth, GitHub App repo authority, and session-scoped MCP grants on real Postgres', () => {
  it.live(
    'enforces WorkOS + GitHub App dual authority, authenticates MCP callers over Streamable HTTP, enforces session-scoped delegated grants, and rejects negative security scenarios',
    () =>
      Effect.gen(function* () {
        yield* resetAndMigrateDatabase

        const repoPermissions = new Map<string, RepositoryPermissionLevel>([
          [HUMAN_LOGIN, 'maintain'],
          [READER_LOGIN, 'read'],
        ])
        const futureExpiry = Date.now() + 60 * 60 * 1000

        const workOsLayer = makeWorkOsAuthProviderLayer({
          exchangeGitHubOAuthCode: ({ code }) =>
            Redacted.value(code) === 'code-maintainer'
              ? Effect.succeed({
                  provider: 'GitHubOAuth',
                  identity: {
                    principalId: HUMAN_ID,
                    workOsUserId: 'wos_u_1',
                    workOsSessionId: WorkOsSessionId.make('wos_s_1'),
                    organizationId: ORG_ID,
                    forgeUserLogin: HUMAN_LOGIN,
                    email: 'ugo@okikesolutions.dev',
                    expiresAtMs: futureExpiry,
                  },
                })
              : Effect.fail('invalid oauth code'),
          verifyAccessToken: (token) => {
            const raw = Redacted.value(token)
            if (raw === 'tok-maintainer') {
              return Effect.succeed({
                provider: 'GitHubOAuth',
                identity: {
                  principalId: HUMAN_ID,
                  workOsUserId: 'wos_u_1',
                  workOsSessionId: WorkOsSessionId.make('wos_s_1'),
                  organizationId: ORG_ID,
                  forgeUserLogin: HUMAN_LOGIN,
                  email: 'ugo@okikesolutions.dev',
                  expiresAtMs: futureExpiry,
                },
              })
            }
            if (raw === 'tok-reader') {
              return Effect.succeed({
                provider: 'GitHubOAuth',
                identity: {
                  principalId: READER_ID,
                  workOsUserId: 'wos_u_2',
                  workOsSessionId: WorkOsSessionId.make('wos_s_2'),
                  organizationId: ORG_ID,
                  forgeUserLogin: READER_LOGIN,
                  email: 'reader@okikesolutions.dev',
                  expiresAtMs: futureExpiry,
                },
              })
            }
            return Effect.fail('invalid session token')
          },
          checkOrganizationMembership: ({ organizationId }) =>
            Effect.succeed(organizationId === ORG_ID),
        })

        const forgeLayer = makeGitHubAppForgeAdapterLayer({
          webhookSecret: Redacted.make('whsec_int_test_secret'),
          createInstallationToken: () =>
            Effect.succeed({
              installationId: 'gh-inst-55',
              token: 'ghs_int_token',
              expiresAtMs: futureExpiry,
            }),
          getCollaboratorPermission: ({ username }) =>
            Effect.succeed({
              installationId: 'gh-inst-55',
              permission: repoPermissions.get(username) ?? 'none',
            }),
          getPullRequest: () =>
            Effect.succeed({
              headSha: GitCommitSha.make('b'.repeat(40)),
              isFork: false,
            }),
        }).pipe(Layer.provide(MacLayer))

        const mcpAuthLayer = Layer.succeed(
          McpCallerAuthenticator,
          McpCallerAuthenticator.of({
            authenticate: ({ bearerToken, sessionId }) => {
              const raw = Redacted.value(bearerToken)
              if (raw === 'mcp-token-agent-a' && sessionId === SESSION_A) {
                return Effect.succeed({
                  agentActorId: AGENT_A,
                  sessionId: SESSION_A,
                  organizationId: ORG_ID,
                  humanPrincipalId: HUMAN_ID,
                  humanForgeLogin: HUMAN_LOGIN,
                })
              }
              if (raw === 'mcp-token-agent-b' && sessionId === SESSION_B) {
                return Effect.succeed({
                  agentActorId: AGENT_B,
                  sessionId: SESSION_B,
                  organizationId: ORG_ID,
                  humanPrincipalId: HUMAN_ID,
                  humanForgeLogin: HUMAN_LOGIN,
                })
              }
              return Effect.fail(
                new AuthenticationError({
                  reason: 'Invalid MCP bearer token or session binding',
                }),
              )
            },
          }),
        )

        const coreServicesLayer = Layer.mergeAll(
          PostgresAcceptanceStoreLayer,
          PostgresAuthorityStoreLayer,
          workOsLayer,
          forgeLayer,
          mcpAuthLayer,
        )

        // 1) WorkOS GitHub OAuth sign-in + dual authority check on real Postgres
        yield* Effect.gen(function* () {
          const workos = yield* WorkOsAuthProvider
          const acceptance = yield* AcceptanceStore
          const authority = yield* AuthorityStore

          const signedIn = yield* workos.authenticateGitHubOAuthCallback({
            code: Redacted.make('code-maintainer'),
            state: 'csrf-state-123',
            expectedState: 'csrf-state-123',
          })
          expect(signedIn.principalId).toBe(HUMAN_ID)

          // Seed real attempt & proposal version v2 in Postgres
          yield* acceptance.claimAttempt({
            attemptId: ATTEMPT_ID,
            changeRequestId: CHANGE_REQUEST_ID,
          })
          yield* authority.setCurrentProposalVersion({
            attemptId: ATTEMPT_ID,
            repositoryId: REPO_ID,
            currentVersion: ProposalVersion.make(2),
            updatedAtMs: Date.now(),
          })

          // Signed-in WorkOS user with ONLY `read` GitHub App permission MUST be rejected
          const readerDenied = yield* Effect.flip(
            recordHumanAcceptanceDecision({
              sessionToken: Redacted.make('tok-reader'),
              decisionId: DecisionId.make('dec-reader-denied'),
              repositoryId: REPO_ID,
              attemptId: ATTEMPT_ID,
              proposalVersion: ProposalVersion.make(2),
              kind: 'approve',
            }),
          )
          expect(readerDenied._tag).toBe('RepositoryAuthorityError')

          // Maintainer with stale proposal version v1 MUST be rejected
          const staleDenied = yield* Effect.flip(
            recordHumanAcceptanceDecision({
              sessionToken: Redacted.make('tok-maintainer'),
              decisionId: DecisionId.make('dec-stale-denied'),
              repositoryId: REPO_ID,
              attemptId: ATTEMPT_ID,
              proposalVersion: ProposalVersion.make(1),
              kind: 'approve',
            }),
          )
          expect(staleDenied._tag).toBe('StaleProposalVersionError')

          // Maintainer with fresh proposal version v2 succeeds with HumanPrincipal attribution
          const approved = yield* recordHumanAcceptanceDecision({
            sessionToken: Redacted.make('tok-maintainer'),
            decisionId: DecisionId.make('dec-maintainer-ok'),
            repositoryId: REPO_ID,
            attemptId: ATTEMPT_ID,
            proposalVersion: ProposalVersion.make(2),
            kind: 'approve',
          })
          expect(approved.attribution._tag).toBe('HumanPrincipal')

          // Create two active MCP sessions & issue session-scoped grants for Agent A
          yield* authority.createMcpSession({
            sessionId: SESSION_A,
            organizationId: ORG_ID,
            principalId: HUMAN_ID,
            agentActorId: AGENT_A,
            createdAtMs: Date.now(),
          })
          yield* authority.createMcpSession({
            sessionId: SESSION_B,
            organizationId: ORG_ID,
            principalId: HUMAN_ID,
            agentActorId: AGENT_B,
            createdAtMs: Date.now(),
          })

          yield* issueSessionScopedMcpGrant({
            caller: {
              _tag: 'HumanSession',
              sessionToken: Redacted.make('tok-maintainer'),
            },
            grantId: McpGrantId.make('grant-int-1'),
            repositoryId: REPO_ID,
            agentActorId: AGENT_A,
            sessionId: SESSION_A,
            allowedFields: ['verification.max_wall_clock_minutes'],
          })
          yield* issueSessionScopedMcpGrant({
            caller: {
              _tag: 'HumanSession',
              sessionToken: Redacted.make('tok-maintainer'),
            },
            grantId: McpGrantId.make('grant-int-2'),
            repositoryId: REPO_ID,
            agentActorId: AGENT_A,
            sessionId: SESSION_A,
            allowedFields: ['verification.max_wall_clock_minutes'],
          })
        }).pipe(Effect.provide(coreServicesLayer))

        // 2) Boot REAL Effect v4 Streamable HTTP MCP Server via HttpRouter.toWebHandler
        //    (works identically on Node Vitest & Bun with zero port contention)
        const sqlClient = yield* SqlClient.SqlClient
        const mcpAppLayer = makePatchplaneMcpHttpLayer('/mcp').pipe(
          Layer.provide(coreServicesLayer),
          Layer.provide(Layer.succeed(SqlClient.SqlClient, sqlClient)),
        )

        yield* Effect.scoped(
          Effect.gen(function* () {
            const webApp = HttpRouter.toWebHandler(mcpAppLayer, {
              disableLogger: true,
            })
            yield* Effect.addFinalizer(() =>
              Effect.tryPromise({
                try: () => webApp.dispose(),
                catch: () => 'dispose-failed',
              }).pipe(Effect.ignore),
            )
            const mcpUrl = 'http://127.0.0.1/mcp'

            let rpcSeq = 0
            const mcpRpcRaw = (
              method: string,
              params: Record<string, unknown>,
              headers: Record<string, string>,
            ) =>
              Effect.gen(function* () {
                rpcSeq += 1
                const request = new Request(mcpUrl, {
                  method: 'POST',
                  headers: {
                    accept: 'application/json, text/event-stream',
                    'content-type': 'application/json',
                    'mcp-protocol-version': '2025-11-25',
                    ...headers,
                  },
                  body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: rpcSeq,
                    method,
                    params,
                  }),
                })
                const response = yield* Effect.tryPromise({
                  try: () => webApp.handler(request),
                  catch: (cause) =>
                    new McpTestTransportError({
                      message: `MCP handler failed: ${String(cause)}`,
                    }),
                })
                const contentType = response.headers.get('content-type') ?? ''
                const text = yield* Effect.tryPromise({
                  try: () => response.text(),
                  catch: (cause) =>
                    new McpTestTransportError({
                      message: `MCP body read failed: ${String(cause)}`,
                    }),
                })
                const rawJsonText = contentType.includes('text/event-stream')
                  ? (text
                      .split('\n')
                      .find((line) => line.startsWith('data:'))
                      ?.slice(5)
                      .trim() ?? text)
                  : text
                const parsed: unknown = JSON.parse(rawJsonText)
                const message = Array.isArray(parsed) ? parsed[0] : parsed
                const rpc = yield* Schema.decodeUnknownEffect(
                  JsonRpcResponseSchema,
                )(message)
                return {
                  rpc,
                  status: response.status,
                  mcpSessionId: response.headers.get('mcp-session-id'),
                }
              })

            // Real MCP Streamable HTTP session handshake (2025-11-25)
            const initRes = yield* mcpRpcRaw(
              'initialize',
              {
                protocolVersion: '2025-11-25',
                capabilities: {},
                clientInfo: {
                  name: 'patchplane-integration-client',
                  version: '1.0.0',
                },
              },
              {},
            )
            expect(initRes.status).toBe(200)
            expect(initRes.mcpSessionId).toBeTruthy()
            const transportSessionId = initRes.mcpSessionId ?? ''

            const mcpRpc = (
              method: string,
              params: Record<string, unknown>,
              headers: Record<string, string>,
            ) =>
              mcpRpcRaw(method, params, {
                'mcp-session-id': transportSessionId,
                ...headers,
              }).pipe(Effect.map((r) => r.rpc))

            // 2a) MCP tools/list exposes typed read & delegated mutation tools;
            //     unauthenticated caller is rejected by McpServer.middleware (-32001)
            const listRpc = yield* mcpRpc('tools/list', {}, {})
            const listResult = yield* Schema.decodeUnknownEffect(
              ToolListResultSchema,
            )(listRpc.result)
            const toolNames = listResult.tools.map((t) => t.name)
            expect(toolNames).toContain('patchplane_get_attempt_status')
            expect(toolNames).toContain('patchplane_get_repository_config')
            expect(toolNames).toContain('patchplane_list_audit_events')
            expect(toolNames).toContain('patchplane_update_repository_config')

            const unauthRpc = yield* mcpRpc(
              'tools/call',
              {
                name: 'patchplane_get_attempt_status',
                arguments: { attemptId: ATTEMPT_ID },
              },
              {},
            )
            expect(unauthRpc.error?.code).toBe(-32001)

            const headersA = {
              authorization: 'Bearer mcp-token-agent-a',
              'x-patchplane-session-id': SESSION_A,
            }
            const headersB = {
              authorization: 'Bearer mcp-token-agent-b',
              'x-patchplane-session-id': SESSION_B,
            }

            const callTool = (
              name: string,
              args: Record<string, unknown>,
              headers: Record<string, string>,
            ) =>
              Effect.gen(function* () {
                const rpc = yield* mcpRpc(
                  'tools/call',
                  { name, arguments: args },
                  headers,
                )
                expect(rpc.error).toBeUndefined()
                return yield* Schema.decodeUnknownEffect(CallToolResultSchema)(
                  rpc.result,
                )
              })

            // 2b) Authenticated Agent A reads attempt status over real MCP HTTP
            const statusCall = yield* callTool(
              'patchplane_get_attempt_status',
              { attemptId: ATTEMPT_ID },
              headersA,
            )
            expect(statusCall.isError).not.toBe(true)
            const statusRes = yield* Schema.decodeUnknownEffect(
              AttemptStatusResultSchema,
            )(
              statusCall.structuredContent ??
                JSON.parse(statusCall.content[0]?.text ?? '{}'),
            )
            expect(statusRes.found).toBe(true)
            expect(statusRes.currentProposalVersion).toBe(2)

            // 2c) Authenticated Agent A mutates permitted config field using grant-int-1
            const updateCall = yield* callTool(
              'patchplane_update_repository_config',
              {
                repositoryId: REPO_ID,
                grantId: 'grant-int-1',
                expectedConfigVersion: null,
                patch: { 'verification.max_wall_clock_minutes': 45 },
              },
              headersA,
            )
            expect(updateCall.isError).not.toBe(true)
            const updateOk = yield* Schema.decodeUnknownEffect(
              ConfigToolResultSchema,
            )(
              updateCall.structuredContent ??
                JSON.parse(updateCall.content[0]?.text ?? '{}'),
            )
            expect(updateOk.version).toBe(1)
            expect(updateOk.values['verification.max_wall_clock_minutes']).toBe(
              45,
            )
            expect(updateOk.attribution.agentActorId).toBe(AGENT_A)
            expect(updateOk.attribution.humanDelegatorId).toBe(HUMAN_ID)
            expect(updateOk.attribution.grantId).toBe('grant-int-1')

            // 2d) Disallowed field (`approval.waiver`) fails closed over MCP
            const disallowedRes = yield* callTool(
              'patchplane_update_repository_config',
              {
                repositoryId: REPO_ID,
                grantId: 'grant-int-1',
                expectedConfigVersion: 1,
                patch: { 'approval.waiver': 'auto_policy' },
              },
              headersA,
            )
            expect(disallowedRes.isError).toBe(true)
            expect(JSON.stringify(disallowedRes.content)).toContain(
              'field_not_permitted',
            )

            // 2e) Self-authorization escalation attempt fails closed over MCP
            const selfEscalateRes = yield* callTool(
              'patchplane_update_repository_config',
              {
                repositoryId: REPO_ID,
                grantId: 'grant-int-1',
                expectedConfigVersion: 1,
                patch: { delegated_grant_scope: 'permanent' },
              },
              headersA,
            )
            expect(selfEscalateRes.isError).toBe(true)
            expect(JSON.stringify(selfEscalateRes.content)).toContain(
              'self_authorization_forbidden',
            )

            // 2f) Wrong repository fails closed over MCP
            const wrongRepoRes = yield* callTool(
              'patchplane_update_repository_config',
              {
                repositoryId: OTHER_REPO_ID,
                grantId: 'grant-int-1',
                expectedConfigVersion: null,
                patch: { 'verification.max_wall_clock_minutes': 20 },
              },
              headersA,
            )
            expect(wrongRepoRes.isError).toBe(true)
            expect(JSON.stringify(wrongRepoRes.content)).toContain(
              'wrong_repository',
            )

            // 2g) Wrong actor (Agent B presenting Agent A's grant-int-1) fails closed over MCP
            const wrongActorRes = yield* callTool(
              'patchplane_update_repository_config',
              {
                repositoryId: REPO_ID,
                grantId: 'grant-int-1',
                expectedConfigVersion: 1,
                patch: { 'verification.max_wall_clock_minutes': 20 },
              },
              headersB,
            )
            expect(wrongActorRes.isError).toBe(true)
            expect(JSON.stringify(wrongActorRes.content)).toContain(
              'wrong_actor',
            )

            // 2h) Immediate manual revocation of grant-int-1 blocks subsequent MCP calls
            yield* revokeDelegatedMcpGrant({
              caller: {
                _tag: 'HumanSession',
                sessionToken: Redacted.make('tok-maintainer'),
              },
              grantId: McpGrantId.make('grant-int-1'),
            }).pipe(Effect.provide(coreServicesLayer))

            const afterRevokeRes = yield* callTool(
              'patchplane_update_repository_config',
              {
                repositoryId: REPO_ID,
                grantId: 'grant-int-1',
                expectedConfigVersion: 1,
                patch: { 'verification.max_wall_clock_minutes': 20 },
              },
              headersA,
            )
            expect(afterRevokeRes.isError).toBe(true)
            expect(JSON.stringify(afterRevokeRes.content)).toContain(
              'grant_revoked',
            )

            // 2i) Session termination automatically expires grant-int-2 in Postgres
            const terminated = yield* terminateMcpSessionAndExpireGrants(
              SESSION_A,
            ).pipe(Effect.provide(coreServicesLayer))
            expect(terminated.expiredGrantCount).toBe(1)

            const grant2Row = yield* Effect.gen(function* () {
              const store = yield* AuthorityStore
              return yield* store.findDelegatedGrant(
                McpGrantId.make('grant-int-2'),
              )
            }).pipe(Effect.provide(PostgresAuthorityStoreLayer))
            expect(Option.isSome(grant2Row)).toBe(true)
            if (Option.isSome(grant2Row)) {
              expect(grant2Row.value.status).toBe('expired')
            }

            const afterTerminateRes = yield* callTool(
              'patchplane_update_repository_config',
              {
                repositoryId: REPO_ID,
                grantId: 'grant-int-2',
                expectedConfigVersion: 1,
                patch: { 'verification.max_wall_clock_minutes': 20 },
              },
              headersA,
            )
            expect(afterTerminateRes.isError).toBe(true)
            expect(JSON.stringify(afterTerminateRes.content)).toContain(
              'session_terminated',
            )

            // 2j) Real Postgres audit log holds every attributed action
            const auditEvents = yield* Effect.gen(function* () {
              const store = yield* AuthorityStore
              return yield* store.listAuditEventsByRepository(REPO_ID)
            }).pipe(Effect.provide(PostgresAuthorityStoreLayer))
            expect(
              auditEvents.some((e) => e.attribution._tag === 'HumanPrincipal'),
            ).toBe(true)
            expect(
              auditEvents.some(
                (e) =>
                  e.attribution._tag === 'DelegatedAgent' &&
                  e.grantId === 'grant-int-1' &&
                  e.afterConfigVersion === 1,
              ),
            ).toBe(true)
          }),
        )
      }).pipe(Effect.provide(TestPostgresSqlLayer)),
    30_000,
  )
})
