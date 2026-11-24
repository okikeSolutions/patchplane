import { describe, expect, it } from '@effect/vitest'
import {
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
  type DecisionInboxStreamEvent,
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

const VALID_TOKEN = 'workos-live-session-token'
const READONLY_TOKEN = 'workos-readonly-session-token'

const ATTEMPT_1 = VerificationAttemptId.make('att-sse-1')
const ATTEMPT_MISSING = VerificationAttemptId.make('att-does-not-exist')
const CR_1 = ChangeRequestId.make('pr-701')
const REPO = RepositoryId.make('okikeSolutions/patchplane')
const VERSION_1 = ProposalVersion.make(1)
const GEN_1 = AttemptGeneration.make(1)
const GEN_2 = AttemptGeneration.make(2)

const MAINTAINER_IDENTITY: WorkOsAuthenticatedIdentity = {
  principalId: HumanPrincipalId.make('human-maintainer-1'),
  workOsUserId: 'wos_user_1',
  workOsSessionId: WorkOsSessionId.make('wos_sess_1'),
  organizationId: OrganizationId.make('org-patchplane'),
  forgeUserLogin: ForgeUserLogin.make('okike-maintainer'),
  email: 'maintainer@patchplane.dev',
  expiresAtMs: 2_000_000_000_000,
}

const READONLY_IDENTITY: WorkOsAuthenticatedIdentity = {
  principalId: HumanPrincipalId.make('human-reader-2'),
  workOsUserId: 'wos_user_2',
  workOsSessionId: WorkOsSessionId.make('wos_sess_2'),
  organizationId: OrganizationId.make('org-patchplane'),
  forgeUserLogin: ForgeUserLogin.make('okike-reader'),
  email: 'reader@patchplane.dev',
  expiresAtMs: 2_000_000_000_000,
}

const SAMPLE_DIFF = [
  '--- a/apps/web/src/view.ts',
  '+++ b/apps/web/src/view.ts',
  '@@ -1,2 +1,3 @@',
  ' export const title = "Inbox"',
  '+export const liveSse = true',
].join('\n')

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

const makeHarness = () =>
  Effect.gen(function* () {
    const initialSummary: AttemptSummary = {
      attemptId: ATTEMPT_1,
      changeRequestId: CR_1,
      repositoryId: REPO,
      title: 'Verify Foldkit SSE decision inbox',
      status: 'running',
      generation: GEN_1,
      proposalVersion: VERSION_1,
      nextAction: 'Waiting for verification checks',
      updatedAtMs: 1_700_000_000_000,
    }

    const detailRef = yield* Ref.make<AttemptDetail>({
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
          if (raw === VALID_TOKEN) {
            return MAINTAINER_IDENTITY
          }
          if (raw === READONLY_TOKEN) {
            return READONLY_IDENTITY
          }
          return yield* new InboxUnauthorizedError({
            message: 'Invalid bearer token',
          })
        }),
      }),
    )

    const backendLayer = Layer.succeed(
      DecisionInboxBackend,
      DecisionInboxBackend.of({
        listInbox: Effect.fn('TestInboxBackend.listInbox')(function* () {
          const detail = yield* Ref.get(detailRef)
          return {
            revision: 1,
            items: [detail.summary],
          }
        }),
        getAttemptDetail: Effect.fn('TestInboxBackend.getAttemptDetail')(
          function* ({
            attemptId,
          }: {
            readonly caller: WorkOsAuthenticatedIdentity
            readonly attemptId: VerificationAttemptId
          }) {
            if (attemptId !== ATTEMPT_1) {
              return yield* new InboxAttemptNotFoundError({
                attemptId,
                message: `Attempt ${attemptId} does not exist`,
              })
            }
            return yield* Ref.get(detailRef)
          },
        ),
        submitDecision: Effect.fn('TestInboxBackend.submitDecision')(
          function* ({
            caller,
            attemptId,
            payload,
          }: {
            readonly caller: WorkOsAuthenticatedIdentity
            readonly attemptId: VerificationAttemptId
            readonly payload: SubmitDecisionPayload
          }) {
            if (caller.principalId === READONLY_IDENTITY.principalId) {
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
              summary: updatedSummary,
              diffText: current.diffText,
              files: current.files,
              decision,
            })
            return { decision, summary: updatedSummary }
          },
        ),
      }),
    )

    const sharedEventBus = yield* Layer.build(DecisionInboxEventBusLive)
    const eventBus = yield* Effect.serviceOption(DecisionInboxEventBus).pipe(
      Effect.provide(sharedEventBus),
      Effect.flatMap((opt) =>
        opt._tag === 'Some'
          ? Effect.succeed(opt.value)
          : Effect.die('DecisionInboxEventBus missing'),
      ),
    )

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
      ({ dispose }) => Effect.promise(dispose),
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
    'enforces bearer auth, decodes typed HTTP errors, and serves inbox REST endpoints',
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness()

        // 1. Unauthenticated caller receives typed unauthorized error
        const unauthError = yield* Effect.gen(function* () {
          const client = yield* WebInboxClient
          return yield* Effect.flip(client.listInbox)
        }).pipe(Effect.provide(harness.makeClientLayer()))
        expect(unauthError.code).toBe('unauthorized')
        expect(unauthError.retryable).toBe(false)

        // 2. Authenticated maintainer loads inbox & attempt detail
        const maintainerLayer = harness.makeClientLayer(VALID_TOKEN)
        const { snapshot, detail } = yield* Effect.gen(function* () {
          const client = yield* WebInboxClient
          const snap = yield* client.listInbox
          const det = yield* client.getAttemptDetail(ATTEMPT_1)
          return { snapshot: snap, detail: det }
        }).pipe(Effect.provide(maintainerLayer))

        expect(snapshot.items).toHaveLength(1)
        expect(snapshot.items[0]?.attemptId).toBe(ATTEMPT_1)
        expect(detail.diffText).toContain('+export const liveSse = true')

        // 3. Missing attempt returns typed 404 not_found
        const notFoundErr = yield* Effect.gen(function* () {
          const client = yield* WebInboxClient
          return yield* Effect.flip(client.getAttemptDetail(ATTEMPT_MISSING))
        }).pipe(Effect.provide(maintainerLayer))
        expect(notFoundErr.code).toBe('not_found')

        // 4. Read-only caller receives typed 403 forbidden on decision submit
        const forbiddenErr = yield* Effect.gen(function* () {
          const client = yield* WebInboxClient
          return yield* Effect.flip(
            client.submitDecision({
              attemptId: ATTEMPT_1,
              payload: { proposalVersion: VERSION_1, kind: 'approve' },
            }),
          )
        }).pipe(Effect.provide(harness.makeClientLayer(READONLY_TOKEN)))
        expect(forbiddenErr.code).toBe('forbidden')

        // 5. Maintainer approves, then conflicting reject returns typed 409 conflict
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
    'streams live SSE updates into Foldkit subscription and interrupts/cleans up cleanly on disposal',
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness()
        const maintainerLayer = harness.makeClientLayer(VALID_TOKEN)

        // Start Foldkit's liveEvents subscription in an isolated scope so we can
        // verify deterministic interruption and server-side PubSub cleanup.
        const receivedQueue = yield* Queue.unbounded<InboxMessage>()
        const snapshotReceived = yield* Deferred.make<void>()
        const statusReceived = yield* Deferred.make<void>()
        const decisionReceived = yield* Deferred.make<void>()

        const subscriptionScope = yield* Scope.make()
        const initialModel = makeInitialInboxModel(undefined, {
          streamEnabled: true,
        })
        const deps =
          inboxSubscriptions.liveEvents.modelToDependencies(initialModel)
        const subscriptionStream =
          inboxSubscriptions.liveEvents.dependenciesToStream(deps)

        const subFiber = yield* subscriptionStream.pipe(
          Stream.runForEach((msg) =>
            Effect.gen(function* () {
              yield* Queue.offer(receivedQueue, msg)
              if (msg._tag === 'SseEventReceived') {
                if (msg.event._tag === 'InboxSnapshotEvent') {
                  yield* Deferred.succeed(snapshotReceived, undefined)
                } else if (
                  msg.event._tag === 'VerificationStatusChangedEvent'
                ) {
                  yield* Deferred.succeed(statusReceived, undefined)
                } else if (msg.event._tag === 'DecisionRecordedEvent') {
                  yield* Deferred.succeed(decisionReceived, undefined)
                }
              }
            }),
          ),
          Effect.provide(maintainerLayer),
          Effect.forkIn(subscriptionScope),
        )

        // Wait until the initial SSE snapshot arrives -> proves real HTTP SSE stream is active
        yield* Deferred.await(snapshotReceived)
        expect(yield* harness.eventBus.activeSubscriberCount).toBe(1)

        // Publish a live verification status change from the server
        const rev2 = yield* harness.eventBus.nextRevision
        const statusEvent: DecisionInboxStreamEvent = {
          _tag: 'VerificationStatusChangedEvent',
          revision: rev2,
          attemptId: ATTEMPT_1,
          status: 'passed',
          generation: GEN_2,
          nextAction: 'All cloud checks passed',
          updatedAtMs: 1_700_000_015_000,
        }
        yield* harness.eventBus.publish(statusEvent)
        yield* Deferred.await(statusReceived)

        // Submitting a decision through the HTTP API broadcasts DecisionRecordedEvent over SSE
        yield* Effect.gen(function* () {
          const client = yield* WebInboxClient
          yield* client.submitDecision({
            attemptId: ATTEMPT_1,
            payload: { proposalVersion: VERSION_1, kind: 'approve' },
          })
        }).pipe(Effect.provide(maintainerLayer))
        yield* Deferred.await(decisionReceived)

        const collected = yield* Queue.takeAll(receivedQueue)
        const tags = collected.map((m) =>
          m._tag === 'SseEventReceived' ? `SSE:${m.event._tag}` : m._tag,
        )
        expect(tags).toContain('SseConnected')
        expect(tags).toContain('SSE:InboxSnapshotEvent')
        expect(tags).toContain('SSE:VerificationStatusChangedEvent')
        expect(tags).toContain('SSE:DecisionRecordedEvent')

        // Interrupt and close the subscription scope (disposal) -> server SSE finalizer runs
        yield* Fiber.interrupt(subFiber)
        yield* Scope.close(subscriptionScope, Exit.void)

        // Wait briefly for web ReadableStream cancel propagation to run PubSub unsubscribe
        let remaining = yield* harness.eventBus.activeSubscriberCount
        for (let attempt = 0; attempt < 25 && remaining > 0; attempt += 1) {
          yield* Effect.yieldNow
          yield* Effect.sleep('10 millis')
          remaining = yield* harness.eventBus.activeSubscriberCount
        }
        expect(remaining).toBe(0)
      }),
  )
})
