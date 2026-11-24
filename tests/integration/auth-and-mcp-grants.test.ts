import { describe, expect, it } from '@effect/vitest'
import { Clock, Data, Effect, Layer, Option, Schema } from 'effect'
import * as Digest from 'effect/crypto/Digest'
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
  AuthorityService,
  AuthorityServiceLayer,
  AuthorityStore,
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
  PolicyRuleId,
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

const ORG_A = OrganizationId.make('org-okike-int')
const ORG_B = OrganizationId.make('org-other-tenant')
const REPO_ID = RepositoryId.make('okikeSolutions/arbeo')
const OTHER_REPO_ID = RepositoryId.make('okikeSolutions/other')
const HUMAN_ID = HumanPrincipalId.make('human-ugo')
const HUMAN_LOGIN = ForgeUserLogin.make('okike-maintainer')
const READER_ID = HumanPrincipalId.make('human-reader')
const READER_LOGIN = ForgeUserLogin.make('okike-reader')
const OUTSIDER_ID = HumanPrincipalId.make('human-outsider')
const OUTSIDER_LOGIN = ForgeUserLogin.make('outsider-org-b')
const AGENT_A = ActorId.make('agent:codex-a')
const AGENT_B = ActorId.make('agent:codex-b')
const AGENT_OUTSIDER = ActorId.make('agent:outsider')
const SESSION_A = McpSessionId.make('mcp-session-a')
const SESSION_B = McpSessionId.make('mcp-session-b')
const SESSION_OUTSIDER = McpSessionId.make('mcp-session-outsider')
const ATTEMPT_1 = VerificationAttemptId.make('attempt-proof5-1')
const ATTEMPT_2 = VerificationAttemptId.make('attempt-proof5-2')
const CHANGE_REQUEST_1 = ChangeRequestId.make('github:okikeSolutions/arbeo#55')
const CHANGE_REQUEST_2 = ChangeRequestId.make('github:okikeSolutions/arbeo#56')

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

const JsonRpcFromJson = Schema.fromJsonString(Schema.Unknown)

const ToolListResultSchema = Schema.Struct({
  tools: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      annotations: Schema.optionalKey(
        Schema.Struct({
          readOnlyHint: Schema.optionalKey(Schema.Boolean),
          destructiveHint: Schema.optionalKey(Schema.Boolean),
        }),
      ),
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
    'approval.requirement_approval': Schema.String,
  }),
  attribution: Schema.TaggedStruct('DelegatedAgent', {
    agentActorId: ActorId,
    humanDelegatorId: HumanPrincipalId,
    grantId: McpGrantId,
    sessionId: McpSessionId,
  }),
  appliesAtNextRecordedAttempt: Schema.Literal(true),
  activeAttemptNotices: Schema.Array(
    Schema.Struct({
      attemptId: VerificationAttemptId,
      configVersion: ConfigVersion,
    }),
  ),
})

const AttemptStatusResultSchema = Schema.Struct({
  attemptId: VerificationAttemptId,
  found: Schema.Boolean,
  status: Schema.optionalKey(Schema.String),
  currentProposalVersion: Schema.optionalKey(ProposalVersion),
})

const ConfigReadResultSchema = Schema.Struct({
  repositoryId: RepositoryId,
  version: Schema.NullOr(ConfigVersion),
})

const AuditListResultSchema = Schema.Struct({
  repositoryId: RepositoryId,
  events: Schema.Array(Schema.Unknown),
})

const decodeToolOutput = <A, I>(
  schema: Schema.Codec<A, I>,
  call: typeof CallToolResultSchema.Type,
) =>
  call.structuredContent !== undefined
    ? Schema.decodeUnknownEffect(schema)(call.structuredContent)
    : Schema.decodeEffect(JsonRpcFromJson)(call.content[0]?.text ?? '{}').pipe(
        Effect.flatMap((u) => Schema.decodeUnknownEffect(schema)(u)),
      )

describe('V2 Stack Proof 5: WorkOS GitHub OAuth, GitHub App repo authority, and session-scoped MCP grants on real Postgres', () => {
  it.live(
    'enforces WorkOS + GitHub App dual authority, authenticates all MCP HTTP methods (including DELETE), enforces cross-tenant read isolation, frozen attempt snapshots, and atomic grant expiry on DELETE /mcp',
    () =>
      Effect.gen(function* () {
        yield* resetAndMigrateDatabase

        const nowMs = yield* Clock.currentTimeMillis
        const futureExpiry = nowMs + 60 * 60 * 1000
        const repoPermissions = new Map<string, RepositoryPermissionLevel>([
          [HUMAN_LOGIN, 'maintain'],
          [READER_LOGIN, 'read'],
          [OUTSIDER_LOGIN, 'none'],
        ])

        const workOsLayer = makeWorkOsAuthProviderLayer({
          exchangeGitHubOAuthCode: ({ code }) =>
            Redacted.value(code) === 'code-maintainer'
              ? Effect.succeed({
                  provider: 'GitHubOAuth',
                  identity: {
                    principalId: HUMAN_ID,
                    workOsUserId: 'wos_u_1',
                    workOsSessionId: WorkOsSessionId.make('wos_s_1'),
                    organizationId: ORG_A,
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
                  organizationId: ORG_A,
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
                  organizationId: ORG_A,
                  forgeUserLogin: READER_LOGIN,
                  email: 'reader@okikesolutions.dev',
                  expiresAtMs: futureExpiry,
                },
              })
            }
            return Effect.fail('invalid session token')
          },
          checkOrganizationMembership: ({ organizationId }) =>
            Effect.succeed(
              organizationId === ORG_A || organizationId === ORG_B,
            ),
        }).pipe(Layer.provide(Digest.layerWebCrypto))

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
            authenticate: ({ bearerToken }) => {
              const raw = Redacted.value(bearerToken)
              if (raw === 'mcp-token-agent-a') {
                return Effect.succeed({
                  agentActorId: AGENT_A,
                  sessionId: SESSION_A,
                  organizationId: ORG_A,
                  humanPrincipalId: HUMAN_ID,
                })
              }
              if (raw === 'mcp-token-agent-b') {
                return Effect.succeed({
                  agentActorId: AGENT_B,
                  sessionId: SESSION_B,
                  organizationId: ORG_A,
                  humanPrincipalId: HUMAN_ID,
                })
              }
              if (raw === 'mcp-token-outsider') {
                return Effect.succeed({
                  agentActorId: AGENT_OUTSIDER,
                  sessionId: SESSION_OUTSIDER,
                  organizationId: ORG_B,
                  humanPrincipalId: OUTSIDER_ID,
                })
              }
              return Effect.fail(
                new AuthenticationError({
                  reason: 'Invalid MCP bearer token',
                }),
              )
            },
          }),
        )

        const sqlClient = yield* SqlClient.SqlClient
        const baseDepsLayer = Layer.mergeAll(
          PostgresAcceptanceStoreLayer,
          PostgresAuthorityStoreLayer,
          workOsLayer,
          forgeLayer,
          mcpAuthLayer,
        ).pipe(
          Layer.provideMerge(Layer.succeed(SqlClient.SqlClient, sqlClient)),
        )

        const fullServicesLayer = AuthorityServiceLayer.pipe(
          Layer.provideMerge(baseDepsLayer),
        )

        yield* Effect.scoped(
          Effect.gen(function* () {
            const workos = yield* WorkOsAuthProvider
            const acceptance = yield* AcceptanceStore
            const authorityStore = yield* AuthorityStore
            const authority = yield* AuthorityService

            // 1) WorkOS GitHub OAuth sign-in + dual authority check on real Postgres
            const signedIn = yield* workos.authenticateGitHubOAuthCallback({
              code: Redacted.make('code-maintainer'),
              state: 'csrf-state-123',
              expectedState: 'csrf-state-123',
            })
            expect(signedIn.principalId).toBe(HUMAN_ID)

            yield* acceptance.claimAttempt({
              attemptId: ATTEMPT_1,
              changeRequestId: CHANGE_REQUEST_1,
            })
            yield* authorityStore.setCurrentProposalVersion({
              attemptId: ATTEMPT_1,
              organizationId: ORG_A,
              repositoryId: REPO_ID,
              currentVersion: ProposalVersion.make(2),
              updatedAtMs: nowMs,
            })

            // Signed-in WorkOS user with ONLY `read` GitHub App permission MUST be rejected
            const readerDenied = yield* Effect.flip(
              authority.recordHumanAcceptanceDecision({
                sessionToken: Redacted.make('tok-reader'),
                decisionId: DecisionId.make('dec-reader-denied'),
                repositoryId: REPO_ID,
                attemptId: ATTEMPT_1,
                proposalVersion: ProposalVersion.make(2),
                kind: 'approve',
              }),
            )
            expect(readerDenied._tag).toBe('RepositoryAuthorityError')

            // Maintainer with stale proposal version v1 MUST be rejected
            const staleDenied = yield* Effect.flip(
              authority.recordHumanAcceptanceDecision({
                sessionToken: Redacted.make('tok-maintainer'),
                decisionId: DecisionId.make('dec-stale-denied'),
                repositoryId: REPO_ID,
                attemptId: ATTEMPT_1,
                proposalVersion: ProposalVersion.make(1),
                kind: 'approve',
              }),
            )
            expect(staleDenied._tag).toBe('StaleProposalVersionError')

            // Maintainer with fresh proposal version v2 succeeds with HumanPrincipal attribution
            const approved = yield* authority.recordHumanAcceptanceDecision({
              sessionToken: Redacted.make('tok-maintainer'),
              decisionId: DecisionId.make('dec-maintainer-ok'),
              repositoryId: REPO_ID,
              attemptId: ATTEMPT_1,
              proposalVersion: ProposalVersion.make(2),
              kind: 'approve',
            })
            expect(approved.attribution._tag).toBe('HumanPrincipal')

            // Create active MCP sessions (Org A agents + Org B outsider)
            yield* authorityStore.createMcpSession({
              sessionId: SESSION_A,
              organizationId: ORG_A,
              principalId: HUMAN_ID,
              principalForgeLogin: HUMAN_LOGIN,
              agentActorId: AGENT_A,
              createdAtMs: nowMs,
            })
            yield* authorityStore.createMcpSession({
              sessionId: SESSION_B,
              organizationId: ORG_A,
              principalId: HUMAN_ID,
              principalForgeLogin: HUMAN_LOGIN,
              agentActorId: AGENT_B,
              createdAtMs: nowMs,
            })
            yield* authorityStore.createMcpSession({
              sessionId: SESSION_OUTSIDER,
              organizationId: ORG_B,
              principalId: OUTSIDER_ID,
              principalForgeLogin: OUTSIDER_LOGIN,
              agentActorId: AGENT_OUTSIDER,
              createdAtMs: nowMs,
            })

            // Agent self-authorization rejected against real Postgres
            const selfAuthPg = yield* Effect.flip(
              authority.issueSessionScopedMcpGrant({
                caller: {
                  _tag: 'AgentCaller',
                  agentActorId: AGENT_A,
                  sessionId: SESSION_A,
                },
                grantId: McpGrantId.make('grant-self-denied'),
                repositoryId: REPO_ID,
                agentActorId: AGENT_A,
                sessionId: SESSION_A,
                allowedFields: ['verification.max_wall_clock_minutes'],
              }),
            )
            expect(selfAuthPg._tag).toBe('McpAuthorizationError')

            // Issue 2 session-scoped grants for Agent A
            yield* authority.issueSessionScopedMcpGrant({
              caller: {
                _tag: 'HumanSession',
                sessionToken: Redacted.make('tok-maintainer'),
              },
              grantId: McpGrantId.make('grant-int-1'),
              repositoryId: REPO_ID,
              agentActorId: AGENT_A,
              sessionId: SESSION_A,
              allowedFields: [
                'verification.max_wall_clock_minutes',
                'approval.requirement_approval',
              ],
            })
            yield* authority.issueSessionScopedMcpGrant({
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

            // 2) Boot REAL Effect v4 Streamable HTTP MCP Server via HttpRouter.toWebHandler
            const mcpAppLayer = makePatchplaneMcpHttpLayer('/mcp').pipe(
              Layer.provide(fullServicesLayer),
            )
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

            const sendRaw = (
              method: 'POST' | 'DELETE',
              headers: Record<string, string>,
              body?: Record<string, unknown>,
            ) =>
              Effect.gen(function* () {
                const request = new Request(mcpUrl, {
                  method,
                  headers: {
                    accept: 'application/json, text/event-stream',
                    'content-type': 'application/json',
                    'mcp-protocol-version': '2025-11-25',
                    ...headers,
                  },
                  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
                })
                const response = yield* Effect.tryPromise({
                  try: () => webApp.handler(request),
                  catch: (cause) =>
                    new McpTestTransportError({
                      message: `MCP handler failed: ${String(cause)}`,
                    }),
                })
                const text = yield* Effect.tryPromise({
                  try: () => response.text(),
                  catch: (cause) =>
                    new McpTestTransportError({
                      message: `MCP body read failed: ${String(cause)}`,
                    }),
                })
                return {
                  status: response.status,
                  contentType: response.headers.get('content-type') ?? '',
                  mcpSessionId: response.headers.get('mcp-session-id'),
                  text,
                }
              })

            let rpcSeq = 0
            const mcpRpcRaw = (
              method: string,
              params: Record<string, unknown>,
              headers: Record<string, string>,
            ) =>
              Effect.gen(function* () {
                rpcSeq += 1
                const res = yield* sendRaw('POST', headers, {
                  jsonrpc: '2.0',
                  id: rpcSeq,
                  method,
                  params,
                })
                if (res.status !== 200) {
                  return {
                    status: res.status,
                    mcpSessionId: res.mcpSessionId,
                    rpc: undefined,
                  }
                }
                const rawJsonText = res.contentType.includes(
                  'text/event-stream',
                )
                  ? (res.text
                      .split('\n')
                      .find((line) => line.startsWith('data:'))
                      ?.slice(5)
                      .trim() ?? res.text)
                  : res.text
                const parsed =
                  yield* Schema.decodeEffect(JsonRpcFromJson)(rawJsonText)
                const message = Array.isArray(parsed) ? parsed[0] : parsed
                const rpc = yield* Schema.decodeUnknownEffect(
                  JsonRpcResponseSchema,
                )(message)
                return {
                  status: res.status,
                  mcpSessionId: res.mcpSessionId,
                  rpc,
                }
              })

            // 2a) Unauthenticated initialize, tools/list, and DELETE /mcp ALL fail with 401
            const unauthInit = yield* mcpRpcRaw(
              'initialize',
              {
                protocolVersion: '2025-11-25',
                capabilities: {},
                clientInfo: { name: 'unauth', version: '1.0.0' },
              },
              {},
            )
            expect(unauthInit.status).toBe(401)

            const unauthDelete = yield* sendRaw('DELETE', {})
            expect(unauthDelete.status).toBe(401)

            // 2b) Authenticated initialize for Agent A, Agent B, and Org B Outsider
            const headersA = { authorization: 'Bearer mcp-token-agent-a' }
            const headersB = { authorization: 'Bearer mcp-token-agent-b' }
            const headersOutsider = {
              authorization: 'Bearer mcp-token-outsider',
            }

            const initA = yield* mcpRpcRaw(
              'initialize',
              {
                protocolVersion: '2025-11-25',
                capabilities: {},
                clientInfo: { name: 'agent-a', version: '1.0.0' },
              },
              headersA,
            )
            expect(initA.status).toBe(200)
            expect(initA.mcpSessionId).toBeTruthy()
            const transportSessionA = initA.mcpSessionId ?? ''

            const initB = yield* mcpRpcRaw(
              'initialize',
              {
                protocolVersion: '2025-11-25',
                capabilities: {},
                clientInfo: { name: 'agent-b', version: '1.0.0' },
              },
              headersB,
            )
            const transportSessionB = initB.mcpSessionId ?? ''

            const initOutsider = yield* mcpRpcRaw(
              'initialize',
              {
                protocolVersion: '2025-11-25',
                capabilities: {},
                clientInfo: { name: 'outsider', version: '1.0.0' },
              },
              headersOutsider,
            )
            const transportSessionOutsider = initOutsider.mcpSessionId ?? ''

            const authHeadersA = {
              ...headersA,
              'mcp-session-id': transportSessionA,
            }
            const authHeadersB = {
              ...headersB,
              'mcp-session-id': transportSessionB,
            }
            const authHeadersOutsider = {
              ...headersOutsider,
              'mcp-session-id': transportSessionOutsider,
            }

            // Spoofed x-patchplane-session-id mismatch fails with 403
            const spoofedHeader = yield* mcpRpcRaw(
              'tools/list',
              {},
              {
                ...authHeadersB,
                'x-patchplane-session-id': SESSION_A,
              },
            )
            expect(spoofedHeader.status).toBe(403)

            // 2c) Authenticated tools/list advertises readOnlyHint: true on read tools
            const listRes = yield* mcpRpcRaw('tools/list', {}, authHeadersA)
            expect(listRes.status).toBe(200)
            const listDecoded = yield* Schema.decodeUnknownEffect(
              ToolListResultSchema,
            )(listRes.rpc?.result)
            const readTool = listDecoded.tools.find(
              (t) => t.name === 'patchplane_get_repository_config',
            )
            expect(readTool?.annotations?.readOnlyHint).toBe(true)

            const callTool = (
              name: string,
              args: Record<string, unknown>,
              headers: Record<string, string>,
            ) =>
              Effect.gen(function* () {
                const res = yield* mcpRpcRaw(
                  'tools/call',
                  { name, arguments: args },
                  headers,
                )
                expect(res.status).toBe(200)
                expect(res.rpc?.error).toBeUndefined()
                return yield* Schema.decodeUnknownEffect(CallToolResultSchema)(
                  res.rpc?.result,
                )
              })

            // 2d) Cross-tenant read isolation: Org B outsider CANNOT read Org A's
            //     attempt status, repo config, or audit log!
            const outsiderAttempt = yield* callTool(
              'patchplane_get_attempt_status',
              { attemptId: ATTEMPT_1 },
              authHeadersOutsider,
            )
            const outsiderAttemptParsed = yield* decodeToolOutput(
              AttemptStatusResultSchema,
              outsiderAttempt,
            )
            expect(outsiderAttemptParsed.found).toBe(false)

            const outsiderConfig = yield* callTool(
              'patchplane_get_repository_config',
              { repositoryId: REPO_ID },
              authHeadersOutsider,
            )
            expect(outsiderConfig.isError).toBe(true)
            expect(JSON.stringify(outsiderConfig.content)).toContain(
              'repository_authority_denied',
            )

            const outsiderAudit = yield* callTool(
              'patchplane_list_audit_events',
              { repositoryId: REPO_ID },
              authHeadersOutsider,
            )
            expect(outsiderAudit.isError).toBe(true)
            expect(JSON.stringify(outsiderAudit.content)).toContain(
              'repository_authority_denied',
            )

            // 2e) Authorized Agent A reads attempt status, config, and audit events
            const statusCall = yield* callTool(
              'patchplane_get_attempt_status',
              { attemptId: ATTEMPT_1 },
              authHeadersA,
            )
            const statusRes = yield* decodeToolOutput(
              AttemptStatusResultSchema,
              statusCall,
            )
            expect(statusRes.found).toBe(true)
            expect(statusRes.currentProposalVersion).toBe(2)

            const initialConfigCall = yield* callTool(
              'patchplane_get_repository_config',
              { repositoryId: REPO_ID },
              authHeadersA,
            )
            const initialConfig = yield* decodeToolOutput(
              ConfigReadResultSchema,
              initialConfigCall,
            )
            expect(initialConfig.version).toBeNull()

            // Stale config version on missing row reports `expected 1, actual none` (not `1, 1`!)
            const staleMissingRow = yield* callTool(
              'patchplane_update_repository_config',
              {
                repositoryId: REPO_ID,
                grantId: 'grant-int-1',
                expectedConfigVersion: 1,
                patch: { 'verification.max_wall_clock_minutes': 45 },
              },
              authHeadersA,
            )
            expect(staleMissingRow.isError).toBe(true)
            expect(JSON.stringify(staleMissingRow.content)).toContain(
              'expected 1, actual none',
            )

            // 2f) Authenticated Agent A mutates permitted fields using grant-int-1
            //     and receives active-attempt notice for ATTEMPT_1
            const updateCall = yield* callTool(
              'patchplane_update_repository_config',
              {
                repositoryId: REPO_ID,
                grantId: 'grant-int-1',
                expectedConfigVersion: null,
                patch: {
                  'verification.max_wall_clock_minutes': 45,
                  'approval.requirement_approval': 'auto_policy',
                },
              },
              authHeadersA,
            )
            expect(updateCall.isError).not.toBe(true)
            const updateOk = yield* decodeToolOutput(
              ConfigToolResultSchema,
              updateCall,
            )
            expect(updateOk.version).toBe(1)
            expect(updateOk.values['verification.max_wall_clock_minutes']).toBe(
              45,
            )
            expect(updateOk.attribution.agentActorId).toBe(AGENT_A)
            expect(updateOk.attribution.humanDelegatorId).toBe(HUMAN_ID)
            expect(updateOk.activeAttemptNotices).toHaveLength(1)
            expect(updateOk.activeAttemptNotices[0]?.attemptId).toBe(ATTEMPT_1)

            // Stale config version `expectedConfigVersion: null` vs actual `1`
            const staleCreateCollision = yield* callTool(
              'patchplane_update_repository_config',
              {
                repositoryId: REPO_ID,
                grantId: 'grant-int-1',
                expectedConfigVersion: null,
                patch: { 'verification.max_wall_clock_minutes': 30 },
              },
              authHeadersA,
            )
            expect(staleCreateCollision.isError).toBe(true)
            expect(JSON.stringify(staleCreateCollision.content)).toContain(
              'expected none, actual 1',
            )

            // 2g) ADR 0007 Q24/Q28 on real Postgres: ATTEMPT_2 captures config v1 (`auto_policy`)
            //     and records PolicyRule attribution
            yield* acceptance.claimAttempt({
              attemptId: ATTEMPT_2,
              changeRequestId: CHANGE_REQUEST_2,
            })
            yield* authorityStore.setCurrentProposalVersion({
              attemptId: ATTEMPT_2,
              organizationId: ORG_A,
              repositoryId: REPO_ID,
              currentVersion: ProposalVersion.make(1),
              updatedAtMs: nowMs + 100,
            })
            const policyRes =
              yield* authority.recordPolicyRuleAcceptanceDecision({
                decisionId: DecisionId.make('dec-policy-int-1'),
                organizationId: ORG_A,
                repositoryId: REPO_ID,
                attemptId: ATTEMPT_2,
                proposalVersion: ProposalVersion.make(1),
                category: 'requirement_approval',
                kind: 'approve',
                policyRuleId: PolicyRuleId.make('rule-auto-req'),
              })
            expect(policyRes.attribution._tag).toBe('PolicyRule')
            expect(policyRes.attribution.policyVersion).toBe(1)

            // 2h) Disallowed field, self-escalation, wrong repo, wrong actor all fail over MCP
            const disallowedRes = yield* callTool(
              'patchplane_update_repository_config',
              {
                repositoryId: REPO_ID,
                grantId: 'grant-int-1',
                expectedConfigVersion: 1,
                patch: { 'approval.waiver': 'auto_policy' },
              },
              authHeadersA,
            )
            expect(disallowedRes.isError).toBe(true)
            expect(JSON.stringify(disallowedRes.content)).toContain(
              'field_not_permitted',
            )

            const selfEscalateRes = yield* callTool(
              'patchplane_update_repository_config',
              {
                repositoryId: REPO_ID,
                grantId: 'grant-int-1',
                expectedConfigVersion: 1,
                patch: { delegated_grant_scope: 'permanent' },
              },
              authHeadersA,
            )
            expect(selfEscalateRes.isError).toBe(true)
            expect(JSON.stringify(selfEscalateRes.content)).toContain(
              'self_authorization_forbidden',
            )

            const wrongRepoRes = yield* callTool(
              'patchplane_update_repository_config',
              {
                repositoryId: OTHER_REPO_ID,
                grantId: 'grant-int-1',
                expectedConfigVersion: null,
                patch: { 'verification.max_wall_clock_minutes': 20 },
              },
              authHeadersA,
            )
            expect(wrongRepoRes.isError).toBe(true)
            expect(JSON.stringify(wrongRepoRes.content)).toContain(
              'wrong_repository',
            )

            const wrongActorRes = yield* callTool(
              'patchplane_update_repository_config',
              {
                repositoryId: REPO_ID,
                grantId: 'grant-int-1',
                expectedConfigVersion: 1,
                patch: { 'verification.max_wall_clock_minutes': 20 },
              },
              authHeadersB,
            )
            expect(wrongActorRes.isError).toBe(true)
            expect(JSON.stringify(wrongActorRes.content)).toContain(
              'wrong_actor',
            )

            // 2i) Immediate manual revocation of grant-int-1 blocks subsequent MCP calls
            yield* authority.revokeDelegatedMcpGrant({
              caller: {
                _tag: 'HumanSession',
                sessionToken: Redacted.make('tok-maintainer'),
              },
              grantId: McpGrantId.make('grant-int-1'),
            })
            const afterRevokeRes = yield* callTool(
              'patchplane_update_repository_config',
              {
                repositoryId: REPO_ID,
                grantId: 'grant-int-1',
                expectedConfigVersion: 1,
                patch: { 'verification.max_wall_clock_minutes': 20 },
              },
              authHeadersA,
            )
            expect(afterRevokeRes.isError).toBe(true)
            expect(JSON.stringify(afterRevokeRes.content)).toContain(
              'grant_revoked',
            )

            // 2j) REAL HTTP `DELETE /mcp` terminates session AND automatically expires
            //     `grant-int-2` in Postgres!
            const deleteRes = yield* sendRaw('DELETE', authHeadersA)
            expect(deleteRes.status).toBe(204)

            const grant2Row = yield* authorityStore.findDelegatedGrant(
              McpGrantId.make('grant-int-2'),
            )
            expect(Option.isSome(grant2Row)).toBe(true)
            if (Option.isSome(grant2Row)) {
              expect(grant2Row.value.status).toBe('expired')
            }

            // Even if Agent A re-initializes a new transport session with its old token,
            // Postgres session `SESSION_A` is terminated so BOTH reads and writes fail!
            const reInitA = yield* mcpRpcRaw(
              'initialize',
              {
                protocolVersion: '2025-11-25',
                capabilities: {},
                clientInfo: { name: 'agent-a-reconnect', version: '1.0.0' },
              },
              headersA,
            )
            const reAuthHeadersA = {
              ...headersA,
              'mcp-session-id': reInitA.mcpSessionId ?? '',
            }
            const readAfterDelete = yield* callTool(
              'patchplane_get_repository_config',
              { repositoryId: REPO_ID },
              reAuthHeadersA,
            )
            expect(readAfterDelete.isError).toBe(true)
            expect(JSON.stringify(readAfterDelete.content)).toContain(
              'session_terminated',
            )

            const writeAfterDelete = yield* callTool(
              'patchplane_update_repository_config',
              {
                repositoryId: REPO_ID,
                grantId: 'grant-int-2',
                expectedConfigVersion: 1,
                patch: { 'verification.max_wall_clock_minutes': 20 },
              },
              reAuthHeadersA,
            )
            expect(writeAfterDelete.isError).toBe(true)
            expect(JSON.stringify(writeAfterDelete.content)).toContain(
              'session_terminated',
            )

            // 2k) Authorized Agent B can list bounded audit events via MCP and
            //     all 3 attribution kinds + session termination exist in Postgres
            const auditCall = yield* callTool(
              'patchplane_list_audit_events',
              { repositoryId: REPO_ID, limit: 50 },
              authHeadersB,
            )
            expect(auditCall.isError).not.toBe(true)
            const auditParsed = yield* decodeToolOutput(
              AuditListResultSchema,
              auditCall,
            )
            expect(auditParsed.events.length).toBeGreaterThanOrEqual(4)

            const auditEvents =
              yield* authorityStore.listAuditEventsByRepository({
                organizationId: ORG_A,
                repositoryId: REPO_ID,
                limit: 100,
              })
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
            expect(
              auditEvents.some((e) => e.attribution._tag === 'PolicyRule'),
            ).toBe(true)
            expect(
              auditEvents.some((e) => e.action === 'mcp_session.terminated'),
            ).toBe(true)
          }),
        ).pipe(Effect.provide(fullServicesLayer))
      }).pipe(Effect.provide(TestPostgresSqlLayer)),
    30_000,
  )
})
