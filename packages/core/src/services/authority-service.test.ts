import { describe, expect, it } from '@effect/vitest'
import { Clock, Duration, Effect, Layer, Option } from 'effect'
import * as Redacted from 'effect/Redacted'
import * as TestClock from 'effect/testing/TestClock'
import {
  type AcceptanceDecision,
  ActorId,
  type ApprovalActionCategory,
  type AuthorityAuditEvent,
  canApproveWithRepositoryPermission,
  ChangeRequestId,
  ConfigVersion,
  ConflictingDecisionError,
  DecisionId,
  DEFAULT_REPOSITORY_CONFIG_VALUES,
  type DelegatedMcpGrant,
  ForgeInstallationId,
  ForgeInstanceId,
  ForgeProviderId,
  ForgeUserLogin,
  GitCommitSha,
  HumanPrincipalId,
  ManualApprovalRequiredError,
  McpAuthorizationError,
  McpGrantId,
  McpSessionId,
  type McpSessionRecord,
  normalizeRepositoryKey,
  OrganizationId,
  PolicyRuleId,
  ProposalVersion,
  ProposalVersionNotFoundError,
  type RepositoryConfigRecord,
  type RepositoryConfigValues,
  RepositoryId,
  type RepositoryPermissionLevel,
  StaleConfigVersionError,
  StaleProposalVersionError,
  VerificationAttemptId,
  type WorkOsAuthenticatedIdentity,
  WorkOsSessionId,
} from '@patchplane/domain'
import { AuthorityService, AuthorityServiceLayer } from './authority-service'
import {
  type AttemptProposalVersionRecord,
  AuthorityStore,
  type RepositoryConfigPatch,
} from './authority-store'
import { ForgeAdapter } from './forge-adapter'
import { WorkOsAuthProvider } from './workos-auth'

const ORG_ID = OrganizationId.make('org-okike')
const OTHER_ORG_ID = OrganizationId.make('org-other')
const REPO_ID = RepositoryId.make('okikeSolutions/arbeo')
const OTHER_REPO_ID = RepositoryId.make('okikeSolutions/other')
const ATTEMPT_1 = VerificationAttemptId.make('attempt-auth-1')
const ATTEMPT_2 = VerificationAttemptId.make('attempt-auth-2')
const HUMAN_ID = HumanPrincipalId.make('user-ugo')
const HUMAN_LOGIN = ForgeUserLogin.make('okike-maintainer')
const OTHER_ORG_HUMAN_ID = HumanPrincipalId.make('user-org-b')
const OTHER_ORG_LOGIN = ForgeUserLogin.make('org-b-admin')
const AGENT_ID = ActorId.make('agent:codex-1')
const OTHER_AGENT_ID = ActorId.make('agent:rogue-2')
const SESSION_ID = McpSessionId.make('mcp-sess-1')
const GRANT_ID = McpGrantId.make('grant-sess-1')

const CATEGORY_TO_FIELD: Record<
  ApprovalActionCategory,
  | 'approval.requirement_approval'
  | 'approval.extension_activation'
  | 'approval.waiver'
> = {
  requirement_approval: 'approval.requirement_approval',
  extension_activation: 'approval.extension_activation',
  waiver: 'approval.waiver',
}

const mergePatch = (
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

const configKey = (orgId: OrganizationId, repoId: RepositoryId) =>
  `${orgId}::${normalizeRepositoryKey(repoId)}`

function makeUnitHarness(options?: {
  readonly permission?: RepositoryPermissionLevel
  readonly isOrgMember?: boolean
}) {
  let repoPermission: RepositoryPermissionLevel =
    options?.permission ?? 'maintain'
  let orgMember = options?.isOrgMember ?? true
  let forgePermissionCalls = 0

  const sessions = new Map<string, McpSessionRecord>()
  const grants = new Map<string, DelegatedMcpGrant>()
  const proposalVersions = new Map<string, AttemptProposalVersionRecord>()
  const configs = new Map<string, RepositoryConfigRecord>()
  const auditEvents: Array<AuthorityAuditEvent> = []
  const decisions = new Map<string, AcceptanceDecision>()

  const humanIdentity: WorkOsAuthenticatedIdentity = {
    principalId: HUMAN_ID,
    workOsUserId: 'wos_user_1',
    workOsSessionId: WorkOsSessionId.make('wos_sess_1'),
    organizationId: ORG_ID,
    forgeUserLogin: HUMAN_LOGIN,
    email: 'ugo@okikesolutions.dev',
    expiresAtMs: 9_999_999_999_999,
  }
  const otherOrgIdentity: WorkOsAuthenticatedIdentity = {
    principalId: OTHER_ORG_HUMAN_ID,
    workOsUserId: 'wos_user_2',
    workOsSessionId: WorkOsSessionId.make('wos_sess_2'),
    organizationId: OTHER_ORG_ID,
    forgeUserLogin: OTHER_ORG_LOGIN,
    email: 'admin@other-org.dev',
    expiresAtMs: 9_999_999_999_999,
  }

  const workOsLayer = Layer.succeed(
    WorkOsAuthProvider,
    WorkOsAuthProvider.of({
      authenticateGitHubOAuthCallback: () => Effect.succeed(humanIdentity),
      verifySessionToken: (token) =>
        Redacted.value(token) === 'wos_org_b_tok'
          ? Effect.succeed(otherOrgIdentity)
          : Effect.succeed(humanIdentity),
      verifyOrganizationMembership: () => Effect.sync(() => orgMember),
    }),
  )

  const forgeLayer = Layer.succeed(
    ForgeAdapter,
    ForgeAdapter.of({
      provider: ForgeProviderId.make('github'),
      instanceId: ForgeInstanceId.make('github.com'),
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
        Effect.sync(() => {
          forgePermissionCalls += 1
          return {
            provider: ForgeProviderId.make('github'),
            instanceId: ForgeInstanceId.make('github.com'),
            repositoryId,
            installationId: ForgeInstallationId.make('inst-1'),
            forgeUserLogin,
            permission: repoPermission,
            canApprove: canApproveWithRepositoryPermission(repoPermission),
          }
        }),
      getPullRequestCandidate: ({ repositoryId, pullNumber }) =>
        Effect.succeed({
          provider: ForgeProviderId.make('github'),
          instanceId: ForgeInstanceId.make('github.com'),
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
      terminateMcpSessionWithAudit: ({ sessionId, terminatedAtMs }) =>
        Effect.sync(() => {
          const existing = sessions.get(sessionId)
          if (existing === undefined) {
            return { session: Option.none(), expiredGrantCount: 0 }
          }
          const terminated: McpSessionRecord = {
            sessionId: existing.sessionId,
            organizationId: existing.organizationId,
            principalId: existing.principalId,
            principalForgeLogin: existing.principalForgeLogin,
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
                humanDelegatorForgeLogin: g.humanDelegatorForgeLogin,
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
      issueDelegatedGrantWithAudit: (input) =>
        Effect.suspend(() => {
          const s = sessions.get(input.sessionId)
          if (s === undefined || s.status !== 'active') {
            return Effect.fail(
              new McpAuthorizationError({
                code: 'session_terminated',
                reason: 'Session not active',
              }),
            )
          }
          if (
            s.principalId !== input.humanDelegatorId ||
            s.organizationId !== input.organizationId ||
            s.agentActorId !== input.agentActorId
          ) {
            return Effect.fail(
              new McpAuthorizationError({
                code: 'wrong_actor',
                reason: 'Session actor/principal mismatch',
              }),
            )
          }
          const rec: DelegatedMcpGrant = {
            grantId: input.grantId,
            organizationId: input.organizationId,
            repositoryId: input.repositoryId,
            humanDelegatorId: input.humanDelegatorId,
            humanDelegatorForgeLogin: input.humanDelegatorForgeLogin,
            agentActorId: input.agentActorId,
            sessionId: input.sessionId,
            allowedFields: input.allowedFields,
            scope: 'session',
            status: 'active',
            createdAtMs: input.createdAtMs,
            expiresAtMs: input.expiresAtMs,
          }
          grants.set(input.grantId, rec)
          auditEvents.push({
            eventId: input.auditEventId,
            organizationId: input.organizationId,
            repositoryId: input.repositoryId,
            action: 'mcp_grant.issued',
            attribution: input.attribution,
            grantId: input.grantId,
            createdAtMs: input.createdAtMs,
          })
          return Effect.succeed(rec)
        }),
      findDelegatedGrant: (id) =>
        Effect.sync(() => Option.fromNullishOr(grants.get(id))),
      revokeDelegatedGrantWithAudit: (input) =>
        Effect.suspend(() => {
          const existing = grants.get(input.grantId)
          if (
            existing === undefined ||
            existing.organizationId !== input.organizationId
          ) {
            return Effect.fail(
              new McpAuthorizationError({
                code: 'missing_grant',
                reason: 'Grant not found',
              }),
            )
          }
          if (existing.status === 'expired') {
            return Effect.fail(
              new McpAuthorizationError({
                code: 'grant_expired',
                reason: 'Grant already expired',
              }),
            )
          }
          if (existing.status === 'revoked') {
            return Effect.succeed(existing)
          }
          const revoked: DelegatedMcpGrant = {
            grantId: existing.grantId,
            organizationId: existing.organizationId,
            repositoryId: existing.repositoryId,
            humanDelegatorId: existing.humanDelegatorId,
            humanDelegatorForgeLogin: existing.humanDelegatorForgeLogin,
            agentActorId: existing.agentActorId,
            sessionId: existing.sessionId,
            allowedFields: existing.allowedFields,
            scope: existing.scope,
            createdAtMs: existing.createdAtMs,
            expiresAtMs: existing.expiresAtMs,
            status: 'revoked',
            revokedBy: input.revokedBy,
            revokedAtMs: input.revokedAtMs,
          }
          grants.set(input.grantId, revoked)
          auditEvents.push({
            eventId: input.auditEventId,
            organizationId: input.organizationId,
            repositoryId: existing.repositoryId,
            action: 'mcp_grant.revoked',
            attribution: input.attribution,
            grantId: existing.grantId,
            createdAtMs: input.revokedAtMs,
          })
          return Effect.succeed(revoked)
        }),
      setCurrentProposalVersion: (input) =>
        Effect.sync(() => {
          const existing = proposalVersions.get(input.attemptId)
          const cfg = configs.get(
            configKey(input.organizationId, input.repositoryId),
          )
          const rec: AttemptProposalVersionRecord = {
            attemptId: input.attemptId,
            organizationId: input.organizationId,
            repositoryId: input.repositoryId,
            currentVersion: input.currentVersion,
            configVersion:
              existing?.configVersion ?? cfg?.version ?? ConfigVersion.make(1),
            configSnapshot:
              existing?.configSnapshot ??
              cfg?.values ??
              DEFAULT_REPOSITORY_CONFIG_VALUES,
            updatedAtMs: input.updatedAtMs,
          }
          proposalVersions.set(input.attemptId, rec)
          return rec
        }),
      findCurrentProposalVersion: (id) =>
        Effect.sync(() => Option.fromNullishOr(proposalVersions.get(id))),
      recordDecisionAtomically: (input) =>
        Effect.gen(function* () {
          const prop = proposalVersions.get(input.attemptId)
          if (
            prop === undefined ||
            prop.organizationId !== input.organizationId ||
            normalizeRepositoryKey(prop.repositoryId) !==
              normalizeRepositoryKey(input.repositoryId)
          ) {
            return yield* new ProposalVersionNotFoundError({
              attemptId: input.attemptId,
              reason: 'No proposal version registered',
            })
          }
          if (prop.currentVersion !== input.proposalVersion) {
            return yield* new StaleProposalVersionError({
              attemptId: input.attemptId,
              expectedVersion: prop.currentVersion,
              actualVersion: input.proposalVersion,
            })
          }
          if (input.policyCheck !== undefined) {
            const field = CATEGORY_TO_FIELD[input.policyCheck.category]
            if (prop.configSnapshot[field] !== 'auto_policy') {
              return yield* new ManualApprovalRequiredError({
                repositoryId: input.repositoryId,
                category: input.policyCheck.category,
                reason: 'Frozen attempt config requires manual approval',
              })
            }
          }
          const key = `${input.attemptId}:${input.proposalVersion}`
          const existing = decisions.get(key)
          if (existing !== undefined) {
            if (
              existing.kind === input.kind &&
              existing.actorId === input.actorId
            ) {
              return {
                decision: existing,
                auditEvent: Option.none(),
                frozenConfigVersion: prop.configVersion,
              }
            }
            return yield* new ConflictingDecisionError({
              attemptId: input.attemptId,
              proposalVersion: input.proposalVersion,
              existingKind: existing.kind,
              requestedKind: input.kind,
              existingActorId: existing.actorId,
              requestedActorId: input.actorId,
            })
          }
          const decision: AcceptanceDecision = {
            id: input.decisionId,
            attemptId: input.attemptId,
            proposalVersion: input.proposalVersion,
            kind: input.kind,
            actorId: input.actorId,
          }
          decisions.set(key, decision)
          const auditEvent: AuthorityAuditEvent = {
            eventId: input.auditEventId,
            organizationId: input.organizationId,
            repositoryId: input.repositoryId,
            action: input.action,
            attemptId: input.attemptId,
            proposalVersion: input.proposalVersion,
            attribution: input.attribution,
            createdAtMs: input.createdAtMs,
          }
          auditEvents.push(auditEvent)
          return {
            decision,
            auditEvent: Option.some(auditEvent),
            frozenConfigVersion: prop.configVersion,
          }
        }),
      getRepositoryConfig: ({ organizationId, repositoryId }) =>
        Effect.sync(() =>
          Option.fromNullishOr(
            configs.get(configKey(organizationId, repositoryId)),
          ),
        ),
      applyDelegatedConfigPatchWithAudit: (input) =>
        Effect.gen(function* () {
          const s = sessions.get(input.sessionId)
          if (s === undefined || s.status !== 'active') {
            return yield* new McpAuthorizationError({
              code: 'session_terminated',
              reason: 'Session terminated',
            })
          }
          const g = grants.get(input.grantId)
          if (g === undefined) {
            return yield* new McpAuthorizationError({
              code: 'missing_grant',
              reason: 'Grant missing',
            })
          }
          if (g.status === 'revoked') {
            return yield* new McpAuthorizationError({
              code: 'grant_revoked',
              reason: 'Grant revoked',
            })
          }
          if (g.status === 'expired' || input.updatedAtMs >= g.expiresAtMs) {
            return yield* new McpAuthorizationError({
              code: 'grant_expired',
              reason: 'Grant expired',
            })
          }
          const key = configKey(input.organizationId, input.repositoryId)
          const current = configs.get(key)
          const currentVersion = current?.version ?? null
          if (currentVersion !== input.expectedVersion) {
            return yield* new StaleConfigVersionError({
              repositoryId: input.repositoryId,
              expectedVersion: input.expectedVersion,
              actualVersion: currentVersion,
            })
          }
          const nextVersion = ConfigVersion.make((currentVersion ?? 0) + 1)
          const nextValues = mergePatch(
            current?.values ?? DEFAULT_REPOSITORY_CONFIG_VALUES,
            input.patch,
          )
          const config: RepositoryConfigRecord = {
            repositoryId: input.repositoryId,
            organizationId: input.organizationId,
            version: nextVersion,
            values: nextValues,
            updatedBy: input.attribution,
            updatedAtMs: input.updatedAtMs,
          }
          configs.set(key, config)
          const auditEvent: AuthorityAuditEvent = {
            eventId: input.auditEventId,
            organizationId: input.organizationId,
            repositoryId: input.repositoryId,
            action: 'repository_config.updated',
            attribution: input.attribution,
            grantId: input.grantId,
            ...(currentVersion !== null
              ? { beforeConfigVersion: currentVersion }
              : {}),
            afterConfigVersion: nextVersion,
            createdAtMs: input.updatedAtMs,
          }
          auditEvents.push(auditEvent)
          const activeAttemptNotices = [...proposalVersions.values()]
            .filter(
              (p) =>
                p.organizationId === input.organizationId &&
                normalizeRepositoryKey(p.repositoryId) ===
                  normalizeRepositoryKey(input.repositoryId),
            )
            .map((p) => ({
              attemptId: p.attemptId,
              repositoryId: input.repositoryId,
              configVersion: nextVersion,
              message: `Config updated to v${nextVersion} while attempt "${p.attemptId}" is active`,
            }))
          return { config, auditEvent, activeAttemptNotices }
        }),
      listAuditEventsByRepository: ({ organizationId, repositoryId }) =>
        Effect.sync(() =>
          auditEvents.filter(
            (e) =>
              e.organizationId === organizationId &&
              normalizeRepositoryKey(e.repositoryId) ===
                normalizeRepositoryKey(repositoryId),
          ),
        ),
    }),
  )

  const depsLayer = Layer.mergeAll(workOsLayer, forgeLayer, authorityStoreLayer)
  const serviceLayer = AuthorityServiceLayer.pipe(Layer.provideMerge(depsLayer))

  return {
    setPermission: (p: RepositoryPermissionLevel) => {
      repoPermission = p
    },
    setOrgMember: (v: boolean) => {
      orgMember = v
    },
    getForgePermissionCalls: () => forgePermissionCalls,
    auditEvents,
    grants,
    layer: serviceLayer,
  }
}

describe('AuthorityService dual-authority, frozen attempt config, policy attribution, and MCP grant negative tests', () => {
  it.effect(
    'rejects mutating approval when WorkOS org membership or GitHub App repo permission is insufficient, and rejects stale proposal versions',
    () =>
      Effect.gen(function* () {
        yield* TestClock.adjust(Duration.millis(10_000))
        const h = makeUnitHarness({ permission: 'read', isOrgMember: false })

        yield* Effect.gen(function* () {
          const store = yield* AuthorityStore
          const auth = yield* AuthorityService
          const now = yield* Clock.currentTimeMillis

          yield* store.setCurrentProposalVersion({
            attemptId: ATTEMPT_1,
            organizationId: ORG_ID,
            repositoryId: REPO_ID,
            currentVersion: ProposalVersion.make(2),
            updatedAtMs: now,
          })

          // Non-member of WorkOS org MUST fail closed
          const nonMember = yield* Effect.flip(
            auth.recordHumanAcceptanceDecision({
              sessionToken: Redacted.make('wos_valid_token'),
              decisionId: DecisionId.make('dec-0'),
              repositoryId: REPO_ID,
              attemptId: ATTEMPT_1,
              proposalVersion: ProposalVersion.make(2),
              kind: 'approve',
            }),
          )
          expect(nonMember._tag).toBe('RepositoryAuthorityError')

          // Active WorkOS org member with only `read` repo permission MUST fail
          h.setOrgMember(true)
          const noAuthority = yield* Effect.flip(
            auth.recordHumanAcceptanceDecision({
              sessionToken: Redacted.make('wos_valid_token'),
              decisionId: DecisionId.make('dec-1'),
              repositoryId: REPO_ID,
              attemptId: ATTEMPT_1,
              proposalVersion: ProposalVersion.make(2),
              kind: 'approve',
            }),
          )
          expect(noAuthority._tag).toBe('RepositoryAuthorityError')

          // Even with `maintain` permission, a stale proposal version (v1 vs v2) MUST fail
          h.setPermission('maintain')
          const stale = yield* Effect.flip(
            auth.recordHumanAcceptanceDecision({
              sessionToken: Redacted.make('wos_valid_token'),
              decisionId: DecisionId.make('dec-2'),
              repositoryId: REPO_ID,
              attemptId: ATTEMPT_1,
              proposalVersion: ProposalVersion.make(1),
              kind: 'approve',
            }),
          )
          expect(stale._tag).toBe('StaleProposalVersionError')

          // Fresh proposal v2 with both WorkOS + GitHub App maintain permission succeeds
          const ok = yield* auth.recordHumanAcceptanceDecision({
            sessionToken: Redacted.make('wos_valid_token'),
            decisionId: DecisionId.make('dec-3'),
            repositoryId: REPO_ID,
            attemptId: ATTEMPT_1,
            proposalVersion: ProposalVersion.make(2),
            kind: 'approve',
          })
          expect(ok.attribution._tag).toBe('HumanPrincipal')
          expect(ok.attribution.principalId).toBe(HUMAN_ID)
        }).pipe(Effect.provide(h.layer))
      }),
  )

  it.effect(
    'enforces frozen attempt config snapshots (ADR 0007 Q24/Q28), active-attempt notices, grant TTL/revocation/termination, cross-tenant revocation oracle defense, and negative security cases',
    () =>
      Effect.gen(function* () {
        yield* TestClock.adjust(Duration.millis(10_000))
        const h = makeUnitHarness({ permission: 'maintain' })

        yield* Effect.gen(function* () {
          const store = yield* AuthorityStore
          const auth = yield* AuthorityService
          const now = yield* Clock.currentTimeMillis

          yield* store.createMcpSession({
            sessionId: SESSION_ID,
            organizationId: ORG_ID,
            principalId: HUMAN_ID,
            principalForgeLogin: HUMAN_LOGIN,
            agentActorId: AGENT_ID,
            createdAtMs: now,
          })
          // ATTEMPT_1 freezes default manual config v1
          yield* store.setCurrentProposalVersion({
            attemptId: ATTEMPT_1,
            organizationId: ORG_ID,
            repositoryId: REPO_ID,
            currentVersion: ProposalVersion.make(1),
            updatedAtMs: now,
          })

          // 1) Agent self-authorization MUST fail closed
          const selfAuth = yield* Effect.flip(
            auth.issueSessionScopedMcpGrant({
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

          // 2) NaN & negative ttlMs MUST fail closed instead of crashing or clamping
          for (const badTtl of [Number.NaN, -5_000, 0]) {
            const badTtlErr = yield* Effect.flip(
              auth.issueSessionScopedMcpGrant({
                caller: {
                  _tag: 'HumanSession',
                  sessionToken: Redacted.make('wos_human_tok'),
                },
                grantId: GRANT_ID,
                repositoryId: REPO_ID,
                agentActorId: AGENT_ID,
                sessionId: SESSION_ID,
                allowedFields: ['approval.requirement_approval'],
                ttlMs: badTtl,
              }),
            )
            expect(badTtlErr._tag).toBe('McpAuthorizationError')
          }

          // 3) Human issues session-scoped grant with 5s TTL
          const grant = yield* auth.issueSessionScopedMcpGrant({
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
          expect(grant.humanDelegatorForgeLogin).toBe(HUMAN_LOGIN)

          // 4) Cross-tenant revocation oracle defense: Org B user gets uniform
          //    `missing_grant` WITHOUT calling Forge or leaking REPO_ID!
          const forgeCallsBefore = h.getForgePermissionCalls()
          const crossOrgRevoke = yield* Effect.flip(
            auth.revokeDelegatedMcpGrant({
              caller: {
                _tag: 'HumanSession',
                sessionToken: Redacted.make('wos_org_b_tok'),
              },
              grantId: GRANT_ID,
            }),
          )
          expect(crossOrgRevoke._tag).toBe('McpAuthorizationError')
          if (crossOrgRevoke._tag === 'McpAuthorizationError') {
            expect(crossOrgRevoke.code).toBe('missing_grant')
          }
          expect(h.getForgePermissionCalls()).toBe(forgeCallsBefore)

          const validCaller = {
            agentActorId: AGENT_ID,
            sessionId: SESSION_ID,
            organizationId: ORG_ID,
            humanPrincipalId: HUMAN_ID,
          }

          // 5) Wrong actor, wrong repo, disallowed field, and self-escalation all fail
          const wrongActor = yield* Effect.flip(
            auth.applyDelegatedConfigUpdate({
              caller: { ...validCaller, agentActorId: OTHER_AGENT_ID },
              grantId: GRANT_ID,
              repositoryId: REPO_ID,
              expectedConfigVersion: null,
              patch: { 'approval.requirement_approval': 'auto_policy' },
            }),
          )
          expect(wrongActor._tag).toBe('McpAuthorizationError')

          const wrongRepo = yield* Effect.flip(
            auth.applyDelegatedConfigUpdate({
              caller: validCaller,
              grantId: GRANT_ID,
              repositoryId: OTHER_REPO_ID,
              expectedConfigVersion: null,
              patch: { 'approval.requirement_approval': 'auto_policy' },
            }),
          )
          expect(wrongRepo._tag).toBe('McpAuthorizationError')

          const escalate = yield* Effect.flip(
            auth.applyDelegatedConfigUpdate({
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

          // 6) Valid delegated config update succeeds AND emits active-attempt notice
          const updated = yield* auth.applyDelegatedConfigUpdate({
            caller: validCaller,
            grantId: GRANT_ID,
            repositoryId: REPO_ID,
            expectedConfigVersion: null,
            patch: { 'approval.requirement_approval': 'auto_policy' },
          })
          expect(updated.attribution._tag).toBe('DelegatedAgent')
          expect(updated.config.version).toBe(1)
          expect(updated.activeAttemptNotices).toHaveLength(1)
          expect(updated.activeAttemptNotices[0]?.attemptId).toBe(ATTEMPT_1)

          // 7) ADR 0007 Q24/Q28: existing ATTEMPT_1 retains its FROZEN manual snapshot
          const stillManualOnOldAttempt = yield* Effect.flip(
            auth.recordPolicyRuleAcceptanceDecision({
              decisionId: DecisionId.make('dec-pol-old'),
              organizationId: ORG_ID,
              repositoryId: REPO_ID,
              attemptId: ATTEMPT_1,
              proposalVersion: ProposalVersion.make(1),
              category: 'requirement_approval',
              kind: 'approve',
              policyRuleId: PolicyRuleId.make('rule-req-auto'),
            }),
          )
          expect(stillManualOnOldAttempt._tag).toBe(
            'ManualApprovalRequiredError',
          )

          // Newly recorded ATTEMPT_2 captures updated config v1 (`auto_policy`)!
          yield* store.setCurrentProposalVersion({
            attemptId: ATTEMPT_2,
            organizationId: ORG_ID,
            repositoryId: REPO_ID,
            currentVersion: ProposalVersion.make(1),
            updatedAtMs: yield* Clock.currentTimeMillis,
          })
          const policyDecision = yield* auth.recordPolicyRuleAcceptanceDecision(
            {
              decisionId: DecisionId.make('dec-pol-new'),
              organizationId: ORG_ID,
              repositoryId: REPO_ID,
              attemptId: ATTEMPT_2,
              proposalVersion: ProposalVersion.make(1),
              category: 'requirement_approval',
              kind: 'approve',
              policyRuleId: PolicyRuleId.make('rule-req-auto'),
            },
          )
          expect(policyDecision.attribution._tag).toBe('PolicyRule')
          expect(policyDecision.attribution.policyVersion).toBe(1)

          // 8) Upstream repo authority revocation blocks both read & write access
          h.setPermission('none')
          const readDenied = yield* Effect.flip(
            auth.verifyMcpReadAccess({
              caller: validCaller,
              repositoryId: REPO_ID,
            }),
          )
          expect(readDenied._tag).toBe('RepositoryAuthorityError')

          h.setPermission('read')
          const writeDenied = yield* Effect.flip(
            auth.applyDelegatedConfigUpdate({
              caller: validCaller,
              grantId: GRANT_ID,
              repositoryId: REPO_ID,
              expectedConfigVersion: ConfigVersion.make(1),
              patch: { 'approval.requirement_approval': 'manual' },
            }),
          )
          expect(writeDenied._tag).toBe('RepositoryAuthorityError')
          h.setPermission('maintain')

          // 9) TestClock TTL expiration rejects grant automatically
          yield* TestClock.adjust(Duration.millis(5_001))
          const expired = yield* Effect.flip(
            auth.applyDelegatedConfigUpdate({
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

          // 10) Immediate manual revocation + idempotent re-revoke (zero duplicate audit)
          const grant2 = McpGrantId.make('grant-sess-2')
          yield* auth.issueSessionScopedMcpGrant({
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
          yield* auth.revokeDelegatedMcpGrant({
            caller: {
              _tag: 'HumanSession',
              sessionToken: Redacted.make('wos_human_tok'),
            },
            grantId: grant2,
          })
          const revokeEventsBefore = h.auditEvents.filter(
            (e) => e.action === 'mcp_grant.revoked' && e.grantId === grant2,
          ).length
          yield* auth.revokeDelegatedMcpGrant({
            caller: {
              _tag: 'HumanSession',
              sessionToken: Redacted.make('wos_human_tok'),
            },
            grantId: grant2,
          })
          const revokeEventsAfter = h.auditEvents.filter(
            (e) => e.action === 'mcp_grant.revoked' && e.grantId === grant2,
          ).length
          expect(revokeEventsBefore).toBe(1)
          expect(revokeEventsAfter).toBe(1)

          // 11) Session termination atomically expires remaining active grants
          const grant3 = McpGrantId.make('grant-sess-3')
          yield* auth.issueSessionScopedMcpGrant({
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
          const termRes = yield* auth.terminateMcpSession({
            caller: {
              _tag: 'AuthenticatedMcpSession',
              caller: validCaller,
            },
            sessionId: SESSION_ID,
          })
          expect(termRes.expiredGrantCount).toBe(2)
          expect(h.grants.get(grant3)?.status).toBe('expired')

          // Terminated session cannot read OR write
          const readAfterTerm = yield* Effect.flip(
            auth.verifyMcpReadAccess({
              caller: validCaller,
              repositoryId: REPO_ID,
            }),
          )
          expect(readAfterTerm._tag).toBe('McpAuthorizationError')
        }).pipe(Effect.provide(h.layer))
      }),
  )
})
