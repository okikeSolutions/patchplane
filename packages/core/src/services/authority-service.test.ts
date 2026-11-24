import { describe, expect, it } from '@effect/vitest'
import { Duration, Effect, Layer, Option } from 'effect'
import * as Redacted from 'effect/Redacted'
import * as TestClock from 'effect/testing/TestClock'
import {
  type AcceptanceDecision,
  ActorId,
  AttemptNotFoundError,
  type AuthorityAuditEvent,
  canApproveWithRepositoryPermission,
  ChangeRequestId,
  ConfigVersion,
  DecisionId,
  type DelegatedMcpGrant,
  DeliveryId,
  ForgeInstallationId,
  ForgeProviderId,
  ForgeUserLogin,
  GitCommitSha,
  HumanPrincipalId,
  McpGrantId,
  McpSessionId,
  type McpSessionRecord,
  OrganizationId,
  PolicyRuleId,
  ProposalVersion,
  type RepositoryConfigRecord,
  RepositoryId,
  type RepositoryPermissionLevel,
  StaleConfigVersionError,
  VerificationAttemptId,
  type WorkOsAuthenticatedIdentity,
  WorkOsSessionId,
} from '@patchplane/domain'
import { AcceptanceStore } from './acceptance-store'
import {
  applyDelegatedConfigUpdate,
  issueSessionScopedMcpGrant,
  recordHumanAcceptanceDecision,
  recordPolicyRuleAcceptanceDecision,
  revokeDelegatedMcpGrant,
  terminateMcpSessionAndExpireGrants,
} from './authority-service'
import {
  type AttemptProposalVersionRecord,
  AuthorityStore,
} from './authority-store'
import { ForgeAdapter } from './forge-adapter'
import { WorkOsAuthProvider } from './workos-auth'

const ORG_ID = OrganizationId.make('org-okike')
const REPO_ID = RepositoryId.make('okikeSolutions/arbeo')
const OTHER_REPO_ID = RepositoryId.make('okikeSolutions/other')
const ATTEMPT_ID = VerificationAttemptId.make('attempt-auth-1')
const HUMAN_ID = HumanPrincipalId.make('user-ugo')
const HUMAN_LOGIN = ForgeUserLogin.make('okike-maintainer')
const AGENT_ID = ActorId.make('agent:codex-1')
const OTHER_AGENT_ID = ActorId.make('agent:rogue-2')
const SESSION_ID = McpSessionId.make('mcp-sess-1')
const GRANT_ID = McpGrantId.make('grant-sess-1')

function makeUnitHarness(options?: {
  readonly permission?: RepositoryPermissionLevel
  readonly isOrgMember?: boolean
}) {
  let repoPermission: RepositoryPermissionLevel =
    options?.permission ?? 'maintain'
  let orgMember = options?.isOrgMember ?? true

  const sessions = new Map<string, McpSessionRecord>()
  const grants = new Map<string, DelegatedMcpGrant>()
  const proposalVersions = new Map<string, AttemptProposalVersionRecord>()
  const configs = new Map<string, RepositoryConfigRecord>()
  const auditEvents: Array<AuthorityAuditEvent> = []
  const decisions: Array<AcceptanceDecision> = []

  const humanIdentity: WorkOsAuthenticatedIdentity = {
    principalId: HUMAN_ID,
    workOsUserId: 'wos_user_1',
    workOsSessionId: WorkOsSessionId.make('wos_sess_1'),
    organizationId: ORG_ID,
    forgeUserLogin: HUMAN_LOGIN,
    email: 'ugo@okikesolutions.dev',
    expiresAtMs: 9_999_999_999_999,
  }

  const workOsLayer = Layer.succeed(
    WorkOsAuthProvider,
    WorkOsAuthProvider.of({
      authenticateGitHubOAuthCallback: () => Effect.succeed(humanIdentity),
      verifySessionToken: () => Effect.succeed(humanIdentity),
      verifyOrganizationMembership: () => Effect.sync(() => orgMember),
    }),
  )

  const forgeLayer = Layer.succeed(
    ForgeAdapter,
    ForgeAdapter.of({
      provider: ForgeProviderId.make('github'),
      capabilities: {
        supportsPullRequests: true,
        supportsWebhooks: true,
        supportsInstallationTokens: true,
        supportsRepositoryPermissions: true,
        supportsStatusChecks: true,
      },
      verifyWebhookSignature: () => Effect.void,
      getInstallationToken: () =>
        Effect.succeed({
          installationId: ForgeInstallationId.make('inst-1'),
          token: Redacted.make('ghs_tok'),
          expiresAtMs: 9_999_999_999_999,
        }),
      checkRepositoryAuthority: ({ repositoryId, forgeUserLogin }) =>
        Effect.sync(() => ({
          provider: ForgeProviderId.make('github'),
          repositoryId,
          installationId: ForgeInstallationId.make('inst-1'),
          forgeUserLogin,
          permission: repoPermission,
          canApprove: canApproveWithRepositoryPermission(repoPermission),
        })),
      getPullRequestCandidate: ({ repositoryId, pullNumber }) =>
        Effect.succeed({
          provider: ForgeProviderId.make('github'),
          changeRequestId: ChangeRequestId.make(
            `github:${repositoryId}#${pullNumber}`,
          ),
          repositoryId,
          pullNumber,
          headSha: GitCommitSha.make('a'.repeat(40)),
          isFork: false,
        }),
    }),
  )

  const acceptanceLayer = Layer.succeed(
    AcceptanceStore,
    AcceptanceStore.of({
      recordDeliveryReceipt: () =>
        Effect.succeed({
          deliveryId: DeliveryId.make('d1'),
          inserted: true,
        }),
      claimAttempt: () => Effect.die('unused'),
      advanceAttemptState: () => Effect.die('unused'),
      recordDecision: (input) =>
        Effect.sync(() => {
          const decision: AcceptanceDecision = {
            id: input.decisionId,
            attemptId: input.attemptId,
            proposalVersion: input.proposalVersion,
            kind: input.kind,
            actorId: input.actorId,
          }
          decisions.push(decision)
          return decision
        }),
      findAttemptById: (attemptId) =>
        Effect.fail(new AttemptNotFoundError({ attemptId })),
    }),
  )

  const authorityStoreLayer = Layer.succeed(
    AuthorityStore,
    AuthorityStore.of({
      createMcpSession: (input) =>
        Effect.sync(() => {
          const rec: McpSessionRecord = {
            ...input,
            status: 'active',
          }
          sessions.set(input.sessionId, rec)
          return rec
        }),
      findMcpSession: (id) =>
        Effect.sync(() => Option.fromNullishOr(sessions.get(id))),
      terminateMcpSession: ({ sessionId, terminatedAtMs }) =>
        Effect.sync(() => {
          const existing = sessions.get(sessionId)
          if (existing === undefined) {
            return { session: Option.none(), expiredGrantCount: 0 }
          }
          const terminated: McpSessionRecord = {
            sessionId: existing.sessionId,
            organizationId: existing.organizationId,
            principalId: existing.principalId,
            agentActorId: existing.agentActorId,
            createdAtMs: existing.createdAtMs,
            status: 'terminated',
            terminatedAtMs,
          }
          sessions.set(sessionId, terminated)
          let expiredGrantCount = 0
          for (const [k, g] of grants) {
            if (g.sessionId === sessionId && g.status === 'active') {
              grants.set(k, {
                grantId: g.grantId,
                organizationId: g.organizationId,
                repositoryId: g.repositoryId,
                humanDelegatorId: g.humanDelegatorId,
                agentActorId: g.agentActorId,
                sessionId: g.sessionId,
                allowedFields: g.allowedFields,
                scope: g.scope,
                createdAtMs: g.createdAtMs,
                expiresAtMs: g.expiresAtMs,
                status: 'expired',
              })
              expiredGrantCount += 1
            }
          }
          return { session: Option.some(terminated), expiredGrantCount }
        }),
      issueDelegatedGrant: (input) =>
        Effect.sync(() => {
          const rec: DelegatedMcpGrant = {
            ...input,
            scope: 'session',
            status: 'active',
          }
          grants.set(input.grantId, rec)
          return rec
        }),
      findDelegatedGrant: (id) =>
        Effect.sync(() => Option.fromNullishOr(grants.get(id))),
      revokeDelegatedGrant: ({ grantId, revokedBy, revokedAtMs }) =>
        Effect.sync(() => {
          const existing = grants.get(grantId)
          if (existing === undefined) return Option.none()
          const revoked: DelegatedMcpGrant = {
            grantId: existing.grantId,
            organizationId: existing.organizationId,
            repositoryId: existing.repositoryId,
            humanDelegatorId: existing.humanDelegatorId,
            agentActorId: existing.agentActorId,
            sessionId: existing.sessionId,
            allowedFields: existing.allowedFields,
            scope: existing.scope,
            createdAtMs: existing.createdAtMs,
            expiresAtMs: existing.expiresAtMs,
            status: 'revoked',
            revokedBy,
            revokedAtMs,
          }
          grants.set(grantId, revoked)
          return Option.some(revoked)
        }),
      setCurrentProposalVersion: (input) =>
        Effect.sync(() => {
          proposalVersions.set(input.attemptId, input)
          return input
        }),
      findCurrentProposalVersion: (id) =>
        Effect.sync(() => Option.fromNullishOr(proposalVersions.get(id))),
      getRepositoryConfig: (id) =>
        Effect.sync(() => Option.fromNullishOr(configs.get(id))),
      updateRepositoryConfigWithAudit: (input) =>
        Effect.suspend(() => {
          const current = configs.get(input.repositoryId)
          const currentVersion = current?.version ?? null
          if (currentVersion !== input.expectedVersion) {
            return Effect.fail(
              new StaleConfigVersionError({
                repositoryId: input.repositoryId,
                expectedVersion: input.expectedVersion ?? ConfigVersion.make(1),
                actualVersion: currentVersion ?? ConfigVersion.make(1),
              }),
            )
          }
          const nextVersion = ConfigVersion.make((currentVersion ?? 0) + 1)
          const config: RepositoryConfigRecord = {
            repositoryId: input.repositoryId,
            version: nextVersion,
            values: input.values,
            updatedBy: input.attribution,
            updatedAtMs: input.updatedAtMs,
          }
          configs.set(input.repositoryId, config)
          const auditEvent: AuthorityAuditEvent = {
            eventId: input.auditEventId,
            repositoryId: input.repositoryId,
            action: 'repository_config.updated',
            attribution: input.attribution,
            ...(input.grantId !== undefined ? { grantId: input.grantId } : {}),
            ...(currentVersion !== null
              ? { beforeConfigVersion: currentVersion }
              : {}),
            afterConfigVersion: nextVersion,
            createdAtMs: input.updatedAtMs,
          }
          auditEvents.push(auditEvent)
          return Effect.succeed({ config, auditEvent })
        }),
      recordAuditEvent: (event) =>
        Effect.sync(() => {
          auditEvents.push(event)
          return event
        }),
      listAuditEventsByRepository: (repo) =>
        Effect.sync(() => auditEvents.filter((e) => e.repositoryId === repo)),
    }),
  )

  return {
    setPermission: (p: RepositoryPermissionLevel) => {
      repoPermission = p
    },
    setOrgMember: (v: boolean) => {
      orgMember = v
    },
    auditEvents,
    decisions,
    grants,
    layer: Layer.mergeAll(
      workOsLayer,
      forgeLayer,
      acceptanceLayer,
      authorityStoreLayer,
    ),
  }
}

describe('AuthorityService dual-authority, policy attribution, and MCP grant negative tests', () => {
  it.effect(
    'rejects mutating approval when WorkOS sign-in succeeds but GitHub App repo permission is insufficient, and rejects stale proposal versions',
    () =>
      Effect.gen(function* () {
        yield* TestClock.adjust(Duration.millis(10_000))
        const h = makeUnitHarness({ permission: 'read' })

        yield* Effect.gen(function* () {
          const store = yield* AuthorityStore
          yield* store.setCurrentProposalVersion({
            attemptId: ATTEMPT_ID,
            repositoryId: REPO_ID,
            currentVersion: ProposalVersion.make(2),
            updatedAtMs: 10_000,
          })

          // Signed-in WorkOS user with only `read` repo permission MUST fail
          const noAuthority = yield* Effect.flip(
            recordHumanAcceptanceDecision({
              sessionToken: Redacted.make('wos_valid_token'),
              decisionId: DecisionId.make('dec-1'),
              repositoryId: REPO_ID,
              attemptId: ATTEMPT_ID,
              proposalVersion: ProposalVersion.make(2),
              kind: 'approve',
            }),
          )
          expect(noAuthority._tag).toBe('RepositoryAuthorityError')

          // Even with `maintain` permission, a stale proposal version (v1 vs current v2) MUST fail
          h.setPermission('maintain')
          const stale = yield* Effect.flip(
            recordHumanAcceptanceDecision({
              sessionToken: Redacted.make('wos_valid_token'),
              decisionId: DecisionId.make('dec-2'),
              repositoryId: REPO_ID,
              attemptId: ATTEMPT_ID,
              proposalVersion: ProposalVersion.make(1),
              kind: 'approve',
            }),
          )
          expect(stale._tag).toBe('StaleProposalVersionError')

          // Fresh proposal v2 with both WorkOS + GitHub App maintain permission succeeds
          const ok = yield* recordHumanAcceptanceDecision({
            sessionToken: Redacted.make('wos_valid_token'),
            decisionId: DecisionId.make('dec-3'),
            repositoryId: REPO_ID,
            attemptId: ATTEMPT_ID,
            proposalVersion: ProposalVersion.make(2),
            kind: 'approve',
          })
          expect(ok.attribution._tag).toBe('HumanPrincipal')
          expect(ok.attribution.principalId).toBe(HUMAN_ID)
        }).pipe(Effect.provide(h.layer))
      }),
  )

  it.effect(
    'enforces session-scoped grant TTL expiry, manual revocation, wrong actor/repo, field scope, agent self-authorization denial, upstream authority revocation, and PolicyRule attribution',
    () =>
      Effect.gen(function* () {
        yield* TestClock.adjust(Duration.millis(10_000))
        const h = makeUnitHarness({ permission: 'maintain' })

        yield* Effect.gen(function* () {
          const store = yield* AuthorityStore
          yield* store.createMcpSession({
            sessionId: SESSION_ID,
            organizationId: ORG_ID,
            principalId: HUMAN_ID,
            agentActorId: AGENT_ID,
            createdAtMs: 10_000,
          })
          yield* store.setCurrentProposalVersion({
            attemptId: ATTEMPT_ID,
            repositoryId: REPO_ID,
            currentVersion: ProposalVersion.make(1),
            updatedAtMs: 10_000,
          })

          // 1) Agent self-authorization MUST fail closed
          const selfAuth = yield* Effect.flip(
            issueSessionScopedMcpGrant({
              caller: {
                _tag: 'AgentCaller',
                agentActorId: AGENT_ID,
                sessionId: SESSION_ID,
              },
              grantId: GRANT_ID,
              repositoryId: REPO_ID,
              agentActorId: AGENT_ID,
              sessionId: SESSION_ID,
              allowedFields: ['approval.requirement_approval'],
            }),
          )
          expect(selfAuth._tag).toBe('McpAuthorizationError')
          if (selfAuth._tag === 'McpAuthorizationError') {
            expect(selfAuth.code).toBe('self_authorization_forbidden')
          }

          // 2) Human issues session-scoped grant with 5s TTL for `approval.requirement_approval`
          const grant = yield* issueSessionScopedMcpGrant({
            caller: {
              _tag: 'HumanSession',
              sessionToken: Redacted.make('wos_human_tok'),
            },
            grantId: GRANT_ID,
            repositoryId: REPO_ID,
            agentActorId: AGENT_ID,
            sessionId: SESSION_ID,
            allowedFields: ['approval.requirement_approval'],
            ttlMs: 5_000,
          })
          expect(grant.scope).toBe('session')

          const validCaller = {
            agentActorId: AGENT_ID,
            sessionId: SESSION_ID,
            organizationId: ORG_ID,
            humanPrincipalId: HUMAN_ID,
            humanForgeLogin: HUMAN_LOGIN,
          }

          // 3) Wrong actor rejected
          const wrongActor = yield* Effect.flip(
            applyDelegatedConfigUpdate({
              caller: { ...validCaller, agentActorId: OTHER_AGENT_ID },
              grantId: GRANT_ID,
              repositoryId: REPO_ID,
              expectedConfigVersion: null,
              patch: { 'approval.requirement_approval': 'auto_policy' },
            }),
          )
          expect(wrongActor._tag).toBe('McpAuthorizationError')
          if (wrongActor._tag === 'McpAuthorizationError') {
            expect(wrongActor.code).toBe('wrong_actor')
          }

          // 4) Wrong repository rejected
          const wrongRepo = yield* Effect.flip(
            applyDelegatedConfigUpdate({
              caller: validCaller,
              grantId: GRANT_ID,
              repositoryId: OTHER_REPO_ID,
              expectedConfigVersion: null,
              patch: { 'approval.requirement_approval': 'auto_policy' },
            }),
          )
          expect(wrongRepo._tag).toBe('McpAuthorizationError')
          if (wrongRepo._tag === 'McpAuthorizationError') {
            expect(wrongRepo.code).toBe('wrong_repository')
          }

          // 5) Field outside allowedFields & self-authorization field both rejected
          const unpermitted = yield* Effect.flip(
            applyDelegatedConfigUpdate({
              caller: validCaller,
              grantId: GRANT_ID,
              repositoryId: REPO_ID,
              expectedConfigVersion: null,
              patch: { 'approval.waiver': 'auto_policy' },
            }),
          )
          expect(unpermitted._tag).toBe('McpAuthorizationError')
          if (unpermitted._tag === 'McpAuthorizationError') {
            expect(unpermitted.code).toBe('field_not_permitted')
          }

          const escalate = yield* Effect.flip(
            applyDelegatedConfigUpdate({
              caller: validCaller,
              grantId: GRANT_ID,
              repositoryId: REPO_ID,
              expectedConfigVersion: null,
              patch: { grant_ttl_ms: 999999 },
            }),
          )
          expect(escalate._tag).toBe('McpAuthorizationError')
          if (escalate._tag === 'McpAuthorizationError') {
            expect(escalate.code).toBe('self_authorization_forbidden')
          }

          // 6) Before config update, policy-rule approval is blocked because default is `manual`
          const manualOnly = yield* Effect.flip(
            recordPolicyRuleAcceptanceDecision({
              decisionId: DecisionId.make('dec-pol-0'),
              repositoryId: REPO_ID,
              attemptId: ATTEMPT_ID,
              proposalVersion: ProposalVersion.make(1),
              category: 'requirement_approval',
              kind: 'approve',
              policyRuleId: PolicyRuleId.make('rule-req-auto'),
            }),
          )
          expect(manualOnly._tag).toBe('McpAuthorizationError')
          if (manualOnly._tag === 'McpAuthorizationError') {
            expect(manualOnly.code).toBe('policy_requires_manual_approval')
          }

          // 7) Valid delegated config update succeeds with DelegatedAgent attribution
          const updated = yield* applyDelegatedConfigUpdate({
            caller: validCaller,
            grantId: GRANT_ID,
            repositoryId: REPO_ID,
            expectedConfigVersion: null,
            patch: { 'approval.requirement_approval': 'auto_policy' },
          })
          expect(updated.attribution._tag).toBe('DelegatedAgent')
          expect(updated.attribution.humanDelegatorId).toBe(HUMAN_ID)
          expect(updated.attribution.agentActorId).toBe(AGENT_ID)
          expect(updated.config.version).toBe(1)

          // 8) PolicyRule automatic decision now succeeds and records PolicyRule attribution
          const policyDecision = yield* recordPolicyRuleAcceptanceDecision({
            decisionId: DecisionId.make('dec-pol-1'),
            repositoryId: REPO_ID,
            attemptId: ATTEMPT_ID,
            proposalVersion: ProposalVersion.make(1),
            category: 'requirement_approval',
            kind: 'approve',
            policyRuleId: PolicyRuleId.make('rule-req-auto'),
          })
          expect(policyDecision.attribution._tag).toBe('PolicyRule')
          expect(policyDecision.attribution.policyRuleId).toBe('rule-req-auto')
          expect(policyDecision.attribution.policyVersion).toBe(1)

          // 9) Upstream human repo authority revocation invalidates delegated execution
          h.setPermission('read')
          const upstreamRevoked = yield* Effect.flip(
            applyDelegatedConfigUpdate({
              caller: validCaller,
              grantId: GRANT_ID,
              repositoryId: REPO_ID,
              expectedConfigVersion: ConfigVersion.make(1),
              patch: { 'approval.requirement_approval': 'manual' },
            }),
          )
          expect(upstreamRevoked._tag).toBe('RepositoryAuthorityError')
          h.setPermission('maintain')

          // 10) TestClock TTL expiration rejects grant automatically
          yield* TestClock.adjust(Duration.millis(5_001))
          const expired = yield* Effect.flip(
            applyDelegatedConfigUpdate({
              caller: validCaller,
              grantId: GRANT_ID,
              repositoryId: REPO_ID,
              expectedConfigVersion: ConfigVersion.make(1),
              patch: { 'approval.requirement_approval': 'manual' },
            }),
          )
          expect(expired._tag).toBe('McpAuthorizationError')
          if (expired._tag === 'McpAuthorizationError') {
            expect(expired.code).toBe('grant_expired')
          }

          // 11) Fresh grant + immediate manual revocation -> rejected with `grant_revoked`
          const grant2 = McpGrantId.make('grant-sess-2')
          yield* issueSessionScopedMcpGrant({
            caller: {
              _tag: 'HumanSession',
              sessionToken: Redacted.make('wos_human_tok'),
            },
            grantId: grant2,
            repositoryId: REPO_ID,
            agentActorId: AGENT_ID,
            sessionId: SESSION_ID,
            allowedFields: ['approval.requirement_approval'],
          })
          yield* revokeDelegatedMcpGrant({
            caller: {
              _tag: 'HumanSession',
              sessionToken: Redacted.make('wos_human_tok'),
            },
            grantId: grant2,
          })
          const revoked = yield* Effect.flip(
            applyDelegatedConfigUpdate({
              caller: validCaller,
              grantId: grant2,
              repositoryId: REPO_ID,
              expectedConfigVersion: ConfigVersion.make(1),
              patch: { 'approval.requirement_approval': 'manual' },
            }),
          )
          expect(revoked._tag).toBe('McpAuthorizationError')
          if (revoked._tag === 'McpAuthorizationError') {
            expect(revoked.code).toBe('grant_revoked')
          }

          // 12) Fresh grant + session termination -> atomically expires grant
          const grant3 = McpGrantId.make('grant-sess-3')
          yield* issueSessionScopedMcpGrant({
            caller: {
              _tag: 'HumanSession',
              sessionToken: Redacted.make('wos_human_tok'),
            },
            grantId: grant3,
            repositoryId: REPO_ID,
            agentActorId: AGENT_ID,
            sessionId: SESSION_ID,
            allowedFields: ['approval.requirement_approval'],
          })
          const termRes = yield* terminateMcpSessionAndExpireGrants(SESSION_ID)
          // Both the clock-expired grant1 row and active grant3 row are marked 'expired'
          expect(termRes.expiredGrantCount).toBe(2)
          expect(h.grants.get(grant3)?.status).toBe('expired')

          const afterTerm = yield* Effect.flip(
            applyDelegatedConfigUpdate({
              caller: validCaller,
              grantId: grant3,
              repositoryId: REPO_ID,
              expectedConfigVersion: ConfigVersion.make(1),
              patch: { 'approval.requirement_approval': 'manual' },
            }),
          )
          expect(afterTerm._tag).toBe('McpAuthorizationError')
          if (afterTerm._tag === 'McpAuthorizationError') {
            expect(afterTerm.code).toBe('session_terminated')
          }
        }).pipe(Effect.provide(h.layer))
      }),
  )
})
