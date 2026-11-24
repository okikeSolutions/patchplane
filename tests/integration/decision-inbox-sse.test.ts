import { describe, expect, it } from '@effect/vitest'
import {
  Context,
  Data,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Path,
  Queue,
  Ref,
  Scope,
  Stream,
} from 'effect'
import {
  Etag,
  HttpClient,
  HttpClientError,
  HttpClientResponse,
  HttpPlatform,
  HttpRouter,
} from 'effect/http'
import * as Redacted from 'effect/Redacted'
import {
  DecisionInboxBackend,
  DecisionInboxEventBus,
  DecisionInboxEventBusLive,
  DecisionInboxHttpLayer,
  InboxCallerAuthenticator,
} from '../../apps/server/src/index'
import {
  DecisionInboxClient as WebInboxClient,
  type InboxMessage,
  inboxSubscriptions,
  makeDecisionInboxClientLayer,
  makeInitialInboxModel,
} from '../../apps/web/src/index'
import {
  type AttemptDetail,
  type AttemptSummary,
  InboxAttemptNotFoundError,
  InboxDecisionConflictError,
  InboxForbiddenError,
  InboxUnauthorizedError,
  type SubmitDecisionPayload,
} from '../../packages/contracts/src/index'
import {
  ActorId,
  AttemptGeneration,
  ChangeRequestId,
  DecisionId,
  ForgeUserLogin,
  HumanPrincipalId,
  OrganizationId,
  ProposalVersion,
  RepositoryId,
  VerificationAttemptId,
  type WorkOsAuthenticatedIdentity,
  WorkOsSessionId,
} from '../../packages/domain/src/index'

const VALID_TOKEN_ORG_A = 'workos-live-session-org-a'
const READONLY_TOKEN_ORG_A = 'workos-readonly-session-org-a'
const RESTRICTED_TOKEN_ORG_A = 'workos-no-repo-access-org-a'
const VALID_TOKEN_ORG_B = 'workos-live-session-org-b'
const EXPIRED_TOKEN_ORG_A = 'workos-expired-session-org-a'

const ORG_A = OrganizationId.make('org-patchplane-a')
const ORG_B = OrganizationId.make('org-patchplane-b')

const ATTEMPT_1 = VerificationAttemptId.make('att-sse-1')
const ATTEMPT_MISSING = VerificationAttemptId.make('att-does-not-exist')
const CR_1 = ChangeRequestId.make('pr-701')
const REPO_A = RepositoryId.make('okikeSolutions/patchplane')
const VERSION_1 = ProposalVersion.make(1)
const GEN_1 = AttemptGeneration.make(1)
const GEN_2 = AttemptGeneration.make(2)

const FUTURE_EXPIRY_MS = Date.now() + 3_600_000
const PAST_EXPIRY_MS = Date.now() - 60_000

const MAINTAINER_ORG_A: WorkOsAuthenticatedIdentity = {
  principalId: HumanPrincipalId.make('human-maintainer-a'),
  workOsUserId: 'wos_user_a1',
  workOsSessionId: WorkOsSessionId.make('wos_sess_a1'),
  organizationId: ORG_A,
  forgeUserLogin: ForgeUserLogin.make('okike-maintainer'),
  email: 'maintainer@patchplane.dev',
  expiresAtMs: FUTURE_EXPIRY_MS,
}

const READONLY_ORG_A: WorkOsAuthenticatedIdentity = {
  principalId: HumanPrincipalId.make('human-reader-a'),
  workOsUserId: 'wos_user_a2',
  workOsSessionId: WorkOsSessionId.make('wos_sess_a2'),
  organizationId: ORG_A,
  forgeUserLogin: ForgeUserLogin.make('okike-reader'),
  email: 'reader@patchplane.dev',
  expiresAtMs: FUTURE_EXPIRY_MS,
}

const RESTRICTED_ORG_A: WorkOsAuthenticatedIdentity = {
  principalId: HumanPrincipalId.make('human-restricted-a'),
  workOsUserId: 'wos_user_a3',
  workOsSessionId: WorkOsSessionId.make('wos_sess_a3'),
  organizationId: ORG_A,
  forgeUserLogin: ForgeUserLogin.make('okike-restricted'),
  email: 'restricted@patchplane.dev',
  expiresAtMs: FUTURE_EXPIRY_MS,
}

const MAINTAINER_ORG_B: WorkOsAuthenticatedIdentity = {
  principalId: HumanPrincipalId.make('human-maintainer-b'),
  workOsUserId: 'wos_user_b1',
  workOsSessionId: WorkOsSessionId.make('wos_sess_b1'),
  organizationId: ORG_B,
  forgeUserLogin: ForgeUserLogin.make('other-org-maintainer'),
  email: 'maintainer@other-org.dev',
  expiresAtMs: FUTURE_EXPIRY_MS,
}

const EXPIRED_ORG_A: WorkOsAuthenticatedIdentity = {
  principalId: MAINTAINER_ORG_A.principalId,
  workOsUserId: MAINTAINER_ORG_A.workOsUserId,
  workOsSessionId: WorkOsSessionId.make('wos_sess_expired'),
  organizationId: MAINTAINER_ORG_A.organizationId,
  forgeUserLogin: MAINTAINER_ORG_A.forgeUserLogin,
  email: MAINTAINER_ORG_A.email,
  expiresAtMs: PAST_EXPIRY_MS,
}

const SAMPLE_DIFF = [
  '--- a/apps/web/src/view.ts',
  '+++ b/apps/web/src/view.ts',
  '@@ -1,1 +1,2 @@',
  ' export const title = "Inbox"',
  '+export const liveSse = true',
].join('\n')

class DisposeHandlerError extends Data.TaggedError('DisposeHandlerError')<{
  readonly cause: unknown
}> {}

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

const makeHarness = Effect.fnUntraced(function* () {
  const initialSummary: AttemptSummary = {
    attemptId: ATTEMPT_1,
    changeRequestId: CR_1,
    repositoryId: REPO_A,
    title: 'Verify Foldkit SSE decision inbox',
    status: 'running',
    generation: GEN_1,
    proposalVersion: VERSION_1,
    nextAction: 'Waiting for verification checks',
    updatedAtMs: 1_700_000_000_000,
  }

  const detailRef = yield* Ref.make<AttemptDetail>({
    revision: 5,
    summary: initialSummary,
    diffText: SAMPLE_DIFF,
    files: [
      {
        path: 'apps/web/src/view.ts',
        hunkCount: 1,
        additions: 1,
        deletions: 0,
      },
    ],
    decision: null,
  })

  const authLayer = Layer.succeed(
    InboxCallerAuthenticator,
    InboxCallerAuthenticator.of({
      authenticate: Effect.fn('TestInboxAuth.authenticate')(function* (
        bearerToken: Redacted.Redacted,
      ) {
        const raw = Redacted.value(bearerToken)
        if (raw === VALID_TOKEN_ORG_A) return MAINTAINER_ORG_A
        if (raw === READONLY_TOKEN_ORG_A) return READONLY_ORG_A
        if (raw === RESTRICTED_TOKEN_ORG_A) return RESTRICTED_ORG_A
        if (raw === VALID_TOKEN_ORG_B) return MAINTAINER_ORG_B
        if (raw === EXPIRED_TOKEN_ORG_A) return EXPIRED_ORG_A
        return yield* new InboxUnauthorizedError({
          message: 'Invalid bearer token',
        })
      }),
    }),
  )

  const backendLayer = Layer.succeed(
    DecisionInboxBackend,
    DecisionInboxBackend.of({
      listInbox: Effect.fn('TestInboxBackend.listInbox')(function* (
        caller: WorkOsAuthenticatedIdentity,
      ) {
        if (caller.organizationId !== ORG_A) {
          return { revision: 1, items: [] }
        }
        if (caller.principalId === RESTRICTED_ORG_A.principalId) {
          return { revision: 5, items: [] }
        }
        const detail = yield* Ref.get(detailRef)
        return {
          revision: detail.revision,
          items: [detail.summary],
        }
      }),
      canReadRepository: ({
        caller,
        repositoryId,
      }: {
        readonly caller: WorkOsAuthenticatedIdentity
        readonly repositoryId: RepositoryId
      }) =>
        Effect.succeed(
          caller.organizationId === ORG_A &&
            repositoryId === REPO_A &&
            caller.principalId !== RESTRICTED_ORG_A.principalId,
        ),
      getAttemptDetail: Effect.fn('TestInboxBackend.getAttemptDetail')(
        function* ({
          caller,
          attemptId,
        }: {
          readonly caller: WorkOsAuthenticatedIdentity
          readonly attemptId: VerificationAttemptId
        }) {
          if (
            caller.organizationId !== ORG_A ||
            caller.principalId === RESTRICTED_ORG_A.principalId
          ) {
            return yield* new InboxForbiddenError({
              message: 'Repository read permission required',
            })
          }
          if (attemptId !== ATTEMPT_1) {
            return yield* new InboxAttemptNotFoundError({
              attemptId,
              message: `Attempt ${attemptId} does not exist`,
            })
          }
          return yield* Ref.get(detailRef)
        },
      ),
      submitDecision: Effect.fn('TestInboxBackend.submitDecision')(function* ({
        caller,
        attemptId,
        payload,
      }: {
        readonly caller: WorkOsAuthenticatedIdentity
        readonly attemptId: VerificationAttemptId
        readonly payload: SubmitDecisionPayload
      }) {
        if (
          caller.organizationId !== ORG_A ||
          caller.principalId !== MAINTAINER_ORG_A.principalId
        ) {
          return yield* new InboxForbiddenError({
            message: 'Maintainer repository write permission required',
          })
        }
        if (attemptId !== ATTEMPT_1) {
          return yield* new InboxAttemptNotFoundError({
            attemptId,
            message: `Attempt ${attemptId} does not exist`,
          })
        }
        const current = yield* Ref.get(detailRef)
        if (
          current.decision !== null &&
          current.decision.proposalVersion === payload.proposalVersion &&
          current.decision.kind !== payload.kind
        ) {
          return yield* new InboxDecisionConflictError({
            attemptId,
            proposalVersion: payload.proposalVersion,
            message: `Proposal v${payload.proposalVersion} already has conflicting decision ${current.decision.kind}`,
          })
        }
        const decision = {
          id: DecisionId.make(`dec-${payload.kind}-1`),
          attemptId,
          proposalVersion: payload.proposalVersion,
          kind: payload.kind,
          actorId: ActorId.make(caller.principalId),
        }
        const updatedSummary: AttemptSummary = {
          attemptId: current.summary.attemptId,
          changeRequestId: current.summary.changeRequestId,
          repositoryId: current.summary.repositoryId,
          title: current.summary.title,
          status: 'passed',
          generation: current.summary.generation,
          proposalVersion: current.summary.proposalVersion,
          nextAction: `Recorded ${payload.kind}`,
          updatedAtMs: current.summary.updatedAtMs + 1000,
        }
        yield* Ref.set(detailRef, {
          revision: current.revision + 1,
          summary: updatedSummary,
          diffText: current.diffText,
          files: current.files,
          decision,
        })
        return { decision, summary: updatedSummary }
      }),
    }),
  )

  const sharedEventBusContext = yield* Layer.build(DecisionInboxEventBusLive)
  const eventBus = Context.get(sharedEventBusContext, DecisionInboxEventBus)

  const platformLayer = Layer.mergeAll(
    Etag.layer,
    HttpPlatform.layer.pipe(Layer.provide(FileSystem.layerNoop({}))),
    FileSystem.layerNoop({}),
    Path.layer,
  )

  const httpLayer = DecisionInboxHttpLayer.pipe(
    Layer.provide(authLayer),
    Layer.provide(backendLayer),
    Layer.provide(Layer.succeed(DecisionInboxEventBus, eventBus)),
    Layer.provide(platformLayer),
  )

  const webHandler = yield* Effect.acquireRelease(
    Effect.sync(() =>
      HttpRouter.toWebHandler(httpLayer, { disableLogger: true }),
    ),
    ({ dispose }) =>
      Effect.tryPromise({
        try: () => dispose(),
        catch: (cause) => new DisposeHandlerError({ cause }),
      }).pipe(Effect.ignore),
  )

  const makeClientLayer = (token?: string) =>
    makeDecisionInboxClientLayer({
      baseUrl: 'http://patchplane.local',
      ...(token !== undefined ? { bearerToken: Redacted.make(token) } : {}),
    }).pipe(
      Layer.provide(
        Layer.succeed(
          HttpClient.HttpClient,
          makeWebHandlerHttpClient((req) => webHandler.handler(req)),
        ),
      ),
    )

  return {
    eventBus,
    makeClientLayer,
    detailRef,
  }
})

describe('Decision Inbox HttpApi + live SSE server-client integration', () => {
  it.live(
    'enforces bearer auth middleware, session expiry, and typed HTTP errors across inbox REST endpoints',
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness()

        // 1. Missing bearer token -> typed unauthorized (401)
        const unauthError = yield* Effect.gen(function* () {
          const client = yield* WebInboxClient
          return yield* Effect.flip(client.listInbox)
        }).pipe(Effect.provide(harness.makeClientLayer()))
        expect(unauthError._tag).toBe('InboxUiError')
        expect(unauthError.code).toBe('unauthorized')
        expect(unauthError.retryable).toBe(false)

        // 2. Expired WorkOS session -> typed unauthorized (401)
        const expiredErr = yield* Effect.gen(function* () {
          const client = yield* WebInboxClient
          return yield* Effect.flip(client.listInbox)
        }).pipe(Effect.provide(harness.makeClientLayer(EXPIRED_TOKEN_ORG_A)))
        expect(expiredErr.code).toBe('unauthorized')

        // 3. Authenticated maintainer loads inbox & attempt detail
        const maintainerLayer = harness.makeClientLayer(VALID_TOKEN_ORG_A)
        const { snapshot, detail } = yield* Effect.gen(function* () {
          const client = yield* WebInboxClient
          const snap = yield* client.listInbox
          const det = yield* client.getAttemptDetail(ATTEMPT_1)
          return { snapshot: snap, detail: det }
        }).pipe(Effect.provide(maintainerLayer))

        expect(snapshot.revision).toBe(5)
        expect(snapshot.items).toHaveLength(1)
        expect(snapshot.items[0]?.attemptId).toBe(ATTEMPT_1)
        expect(detail.diffText).toContain('+export const liveSse = true')

        // 4. Missing attempt returns typed 404 not_found
        const notFoundErr = yield* Effect.gen(function* () {
          const client = yield* WebInboxClient
          return yield* Effect.flip(client.getAttemptDetail(ATTEMPT_MISSING))
        }).pipe(Effect.provide(maintainerLayer))
        expect(notFoundErr.code).toBe('not_found')

        // 5. Read-only caller receives typed 403 forbidden on decision submit
        const forbiddenErr = yield* Effect.gen(function* () {
          const client = yield* WebInboxClient
          return yield* Effect.flip(
            client.submitDecision({
              attemptId: ATTEMPT_1,
              payload: { proposalVersion: VERSION_1, kind: 'approve' },
            }),
          )
        }).pipe(Effect.provide(harness.makeClientLayer(READONLY_TOKEN_ORG_A)))
        expect(forbiddenErr.code).toBe('forbidden')

        // 6. Maintainer approves, then conflicting reject returns typed 409 conflict
        const approved = yield* Effect.gen(function* () {
          const client = yield* WebInboxClient
          return yield* client.submitDecision({
            attemptId: ATTEMPT_1,
            payload: { proposalVersion: VERSION_1, kind: 'approve' },
          })
        }).pipe(Effect.provide(maintainerLayer))
        expect(approved.decision.kind).toBe('approve')

        const conflictErr = yield* Effect.gen(function* () {
          const client = yield* WebInboxClient
          return yield* Effect.flip(
            client.submitDecision({
              attemptId: ATTEMPT_1,
              payload: { proposalVersion: VERSION_1, kind: 'reject' },
            }),
          )
        }).pipe(Effect.provide(maintainerLayer))
        expect(conflictErr.code).toBe('conflict')
      }),
  )

  it.live(
    'streams tenant- & repo-scoped SSE updates with monotonic revisions and cleans up deterministically on disposal',
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness()
        const orgALayer = harness.makeClientLayer(VALID_TOKEN_ORG_A)
        const restrictedOrgALayer = harness.makeClientLayer(
          RESTRICTED_TOKEN_ORG_A,
        )
        const orgBLayer = harness.makeClientLayer(VALID_TOKEN_ORG_B)

        const receivedA = yield* Queue.unbounded<InboxMessage>()
        const receivedRestrictedA = yield* Queue.unbounded<InboxMessage>()
        const receivedB = yield* Queue.unbounded<InboxMessage>()

        const snapshotA = yield* Deferred.make<void>()
        const snapshotRestrictedA = yield* Deferred.make<void>()
        const snapshotB = yield* Deferred.make<void>()
        const statusA = yield* Deferred.make<void>()
        const decisionA = yield* Deferred.make<void>()

        const subScope = yield* Scope.make()
        const deps = inboxSubscriptions.liveEvents.modelToDependencies(
          makeInitialInboxModel(undefined, { streamEnabled: true }),
        )

        const startSubscriber = (
          clientLayer: ReturnType<typeof harness.makeClientLayer>,
          queue: Queue.Queue<InboxMessage>,
          onSnapshot: Deferred.Deferred<void>,
          onStatus?: Deferred.Deferred<void>,
          onDecision?: Deferred.Deferred<void>,
        ) =>
          inboxSubscriptions.liveEvents.dependenciesToStream(deps).pipe(
            Stream.runForEach((msg) =>
              Effect.gen(function* () {
                yield* Queue.offer(queue, msg)
                if (msg._tag === 'SseEventReceived') {
                  if (msg.event._tag === 'InboxSnapshotEvent') {
                    yield* Deferred.succeed(onSnapshot, undefined)
                  } else if (
                    msg.event._tag === 'VerificationStatusChangedEvent' &&
                    onStatus !== undefined
                  ) {
                    yield* Deferred.succeed(onStatus, undefined)
                  } else if (
                    msg.event._tag === 'DecisionRecordedEvent' &&
                    onDecision !== undefined
                  ) {
                    yield* Deferred.succeed(onDecision, undefined)
                  }
                }
              }),
            ),
            Effect.provide(clientLayer),
            Effect.forkIn(subScope),
          )

        const fiberA = yield* startSubscriber(
          orgALayer,
          receivedA,
          snapshotA,
          statusA,
          decisionA,
        )
        const fiberRestrictedA = yield* startSubscriber(
          restrictedOrgALayer,
          receivedRestrictedA,
          snapshotRestrictedA,
        )
        const fiberB = yield* startSubscriber(orgBLayer, receivedB, snapshotB)

        // All 3 streams open and receive their scoped initial snapshots
        yield* Effect.all([
          Deferred.await(snapshotA),
          Deferred.await(snapshotRestrictedA),
          Deferred.await(snapshotB),
        ])
        expect(yield* harness.eventBus.activeSubscriberCount).toBe(3)

        // Publish a live status change in Org A for REPO_A.
        // Because initial snapshot had revision=5, the bus must emit revision > 5 (6)!
        const publishedStatus = yield* harness.eventBus.publish({
          organizationId: ORG_A,
          repositoryId: REPO_A,
          buildEvent: (revision) => ({
            _tag: 'VerificationStatusChangedEvent',
            revision,
            attemptId: ATTEMPT_1,
            repositoryId: REPO_A,
            status: 'passed',
            generation: GEN_2,
            nextAction: 'All cloud checks passed',
            updatedAtMs: 1_700_000_015_000,
          }),
        })
        expect(publishedStatus.revision).toBeGreaterThan(5)
        yield* Deferred.await(statusA)

        // Submit a decision in Org A -> broadcasts DecisionRecordedEvent strictly to authorized Org A subscriber
        yield* Effect.gen(function* () {
          const client = yield* WebInboxClient
          yield* client.submitDecision({
            attemptId: ATTEMPT_1,
            payload: { proposalVersion: VERSION_1, kind: 'approve' },
          })
        }).pipe(Effect.provide(orgALayer))
        yield* Deferred.await(decisionA)

        const msgsA = yield* Queue.takeAll(receivedA)
        const msgsRestrictedA = yield* Queue.takeAll(receivedRestrictedA)
        const msgsB = yield* Queue.takeAll(receivedB)

        const tagsA = msgsA.map((m) =>
          m._tag === 'SseEventReceived' ? `SSE:${m.event._tag}` : m._tag,
        )
        expect(tagsA).toContain('SseConnected')
        expect(tagsA).toContain('SSE:InboxSnapshotEvent')
        expect(tagsA).toContain('SSE:VerificationStatusChangedEvent')
        expect(tagsA).toContain('SSE:DecisionRecordedEvent')

        // Neither Org B nor the repo-restricted Org A caller received Org A's private events!
        const leakedRestricted = msgsRestrictedA.filter(
          (m) =>
            m._tag === 'SseEventReceived' &&
            m.event._tag !== 'InboxSnapshotEvent',
        )
        const leakedB = msgsB.filter(
          (m) =>
            m._tag === 'SseEventReceived' &&
            m.event._tag !== 'InboxSnapshotEvent',
        )
        expect(leakedRestricted).toEqual([])
        expect(leakedB).toEqual([])

        // Watch SubscriptionRef.changes BEFORE disposal to synchronize deterministically (zero sleep polling)
        const allClosed = yield* Deferred.make<void>()
        const watcherFiber =
          yield* harness.eventBus.subscriberCountChanges.pipe(
            Stream.filter((count) => count === 0),
            Stream.take(1),
            Stream.runForEach(() => Deferred.succeed(allClosed, undefined)),
            Effect.forkScoped,
          )

        yield* Fiber.interrupt(fiberA)
        yield* Fiber.interrupt(fiberRestrictedA)
        yield* Fiber.interrupt(fiberB)
        yield* Scope.close(subScope, Exit.void)

        yield* Deferred.await(allClosed)
        yield* Fiber.join(watcherFiber)
        expect(yield* harness.eventBus.activeSubscriberCount).toBe(0)
      }),
  )
})
