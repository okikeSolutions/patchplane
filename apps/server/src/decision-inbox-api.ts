import {
  Clock,
  Context,
  Duration,
  Effect,
  Layer,
  PubSub,
  Ref,
  Semaphore,
  Stream,
  SubscriptionRef,
} from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import type * as Redacted from 'effect/Redacted'
import {
  type AttemptDetail,
  CurrentInboxCaller,
  DecisionInboxApi,
  DecisionInboxAuthMiddleware,
  type DecisionInboxStreamEvent,
  type InboxAttemptNotFoundError,
  type InboxDecisionConflictError,
  type InboxForbiddenError,
  type InboxRevision,
  type InboxServerError,
  type InboxSnapshot,
  InboxUnauthorizedError,
  type SubmitDecisionPayload,
  type SubmitDecisionResponse,
} from '@patchplane/contracts'
import {
  type OrganizationId,
  type RepositoryId,
  type VerificationAttemptId,
  type WorkOsAuthenticatedIdentity,
} from '@patchplane/domain'

const ORG_EVENT_BUS_CAPACITY = 256

export interface InboxCallerAuthenticatorService {
  readonly authenticate: (
    bearerToken: Redacted.Redacted,
  ) => Effect.Effect<WorkOsAuthenticatedIdentity, InboxUnauthorizedError>
}

export class InboxCallerAuthenticator extends Context.Service<
  InboxCallerAuthenticator,
  InboxCallerAuthenticatorService
>()('@patchplane/server/InboxCallerAuthenticator') {}

export interface ScopedInboxEventEnvelope {
  readonly organizationId: OrganizationId
  readonly repositoryId: RepositoryId
  readonly event: DecisionInboxStreamEvent
}

export interface DecisionInboxEventBusService {
  /**
   * Atomically advances the per-organization monotonic revision counter and
   * publishes the built event solely to that organization's bounded stream bus.
   */
  readonly publish: (input: {
    readonly organizationId: OrganizationId
    readonly repositoryId: RepositoryId
    readonly buildEvent: (revision: InboxRevision) => DecisionInboxStreamEvent
  }) => Effect.Effect<DecisionInboxStreamEvent>
  /**
   * Seeds or advances the per-organization revision floor (e.g. from persisted
   * snapshot state) so subsequent live events never regress below snapshot
   * revisions.
   */
  readonly syncRevisionFloor: (input: {
    readonly organizationId: OrganizationId
    readonly revision: InboxRevision
  }) => Effect.Effect<void>
  /**
   * Subscribes to an organization's bounded SSE channel, acquiring the PubSub
   * subscription BEFORE loading the initial snapshot to prevent lost events,
   * filtering out events at or below the snapshot revision, enforcing
   * per-repository read authorization, and terminating when the session
   * expires.
   */
  readonly subscribeForCaller: (input: {
    readonly caller: WorkOsAuthenticatedIdentity
    readonly loadInitialSnapshot: Effect.Effect<
      InboxSnapshot,
      InboxForbiddenError | InboxServerError
    >
    readonly canReadRepository: (
      repositoryId: RepositoryId,
    ) => Effect.Effect<boolean, InboxServerError>
  }) => Effect.Effect<
    Stream.Stream<DecisionInboxStreamEvent, InboxUnauthorizedError>,
    InboxForbiddenError | InboxServerError | InboxUnauthorizedError
  >
  readonly activeSubscriberCount: Effect.Effect<number>
  readonly subscriberCountChanges: Stream.Stream<number>
}

export class DecisionInboxEventBus extends Context.Service<
  DecisionInboxEventBus,
  DecisionInboxEventBusService
>()('@patchplane/server/DecisionInboxEventBus') {}

interface OrganizationEventChannel {
  readonly pubSub: PubSub.PubSub<ScopedInboxEventEnvelope>
  readonly revisionRef: Ref.Ref<number>
  readonly publishLock: Semaphore.Semaphore
}

export const DecisionInboxEventBusLive: Layer.Layer<DecisionInboxEventBus> =
  Layer.effect(
    DecisionInboxEventBus,
    Effect.gen(function* () {
      const channelsRef = yield* Ref.make(
        new Map<OrganizationId, OrganizationEventChannel>(),
      )
      const channelsLock = Semaphore.makeUnsafe(1)
      const activeSubscribersRef = yield* SubscriptionRef.make(0)

      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          const channels = yield* Ref.get(channelsRef)
          for (const channel of channels.values()) {
            yield* PubSub.shutdown(channel.pubSub)
          }
        }),
      )

      const getOrCreateChannel = (
        organizationId: OrganizationId,
      ): Effect.Effect<OrganizationEventChannel> =>
        channelsLock.withPermits(1)(
          Effect.gen(function* () {
            const channels = yield* Ref.get(channelsRef)
            const existing = channels.get(organizationId)
            if (existing !== undefined) {
              return existing
            }
            const pubSub = yield* PubSub.sliding<ScopedInboxEventEnvelope>(
              ORG_EVENT_BUS_CAPACITY,
            )
            const revisionRef = yield* Ref.make(0)
            const created: OrganizationEventChannel = {
              pubSub,
              revisionRef,
              publishLock: Semaphore.makeUnsafe(1),
            }
            const nextMap = new Map(channels)
            nextMap.set(organizationId, created)
            yield* Ref.set(channelsRef, nextMap)
            return created
          }),
        )

      const activeSubscriberCount = SubscriptionRef.get(
        activeSubscribersRef,
      ).pipe(Effect.withSpan('DecisionInboxEventBus.activeSubscriberCount'))

      const subscriberCountChanges =
        SubscriptionRef.changes(activeSubscribersRef)

      return DecisionInboxEventBus.of({
        syncRevisionFloor: Effect.fn('DecisionInboxEventBus.syncRevisionFloor')(
          function* ({ organizationId, revision }) {
            const channel = yield* getOrCreateChannel(organizationId)
            yield* channel.publishLock.withPermits(1)(
              Ref.update(channel.revisionRef, (current) =>
                revision > current ? revision : current,
              ),
            )
          },
        ),

        publish: Effect.fn('DecisionInboxEventBus.publish')(function* ({
          organizationId,
          repositoryId,
          buildEvent,
        }) {
          const channel = yield* getOrCreateChannel(organizationId)
          return yield* channel.publishLock.withPermits(1)(
            Effect.gen(function* () {
              const revision = yield* Ref.updateAndGet(
                channel.revisionRef,
                (current) => current + 1,
              )
              const event = buildEvent(revision)
              yield* PubSub.publish(channel.pubSub, {
                organizationId,
                repositoryId,
                event,
              })
              return event
            }),
          )
        }),

        subscribeForCaller: Effect.fn(
          'DecisionInboxEventBus.subscribeForCaller',
        )(function* ({ caller, loadInitialSnapshot, canReadRepository }) {
          const now = yield* Clock.currentTimeMillis
          const remainingMs = caller.expiresAtMs - now
          if (remainingMs <= 0) {
            return yield* new InboxUnauthorizedError({
              message: 'Authenticated session has expired',
            })
          }

          const channel = yield* getOrCreateChannel(caller.organizationId)

          // Verify caller access eagerly so forbidden/error responses return HTTP
          // 403/500 before switching to 200 text/event-stream.
          const initialSnapshot = yield* loadInitialSnapshot
          yield* channel.publishLock.withPermits(1)(
            Ref.update(channel.revisionRef, (current) =>
              initialSnapshot.revision > current
                ? initialSnapshot.revision
                : current,
            ),
          )

          return Stream.unwrap(
            Effect.gen(function* () {
              // Acquire subscription BEFORE refreshing snapshot inside the stream
              // scope so zero events are missed between snapshot and live tail.
              const subscription = yield* PubSub.subscribe(channel.pubSub)
              yield* Effect.acquireRelease(
                SubscriptionRef.update(
                  activeSubscribersRef,
                  (count) => count + 1,
                ),
                () =>
                  SubscriptionRef.update(activeSubscribersRef, (count) =>
                    count > 0 ? count - 1 : 0,
                  ),
              )

              const refreshedSnapshot = yield* loadInitialSnapshot.pipe(
                Effect.orElseSucceed(() => initialSnapshot),
              )
              yield* channel.publishLock.withPermits(1)(
                Ref.update(channel.revisionRef, (current) =>
                  refreshedSnapshot.revision > current
                    ? refreshedSnapshot.revision
                    : current,
                ),
              )

              const liveEvents = Stream.fromSubscription(subscription).pipe(
                Stream.filter(
                  (envelope) =>
                    envelope.organizationId === caller.organizationId &&
                    envelope.event.revision > refreshedSnapshot.revision,
                ),
                Stream.mapEffect((envelope) =>
                  Effect.gen(function* () {
                    const currentNow = yield* Clock.currentTimeMillis
                    if (currentNow >= caller.expiresAtMs) {
                      return yield* new InboxUnauthorizedError({
                        message: 'Authenticated session has expired',
                      })
                    }
                    const allowed = yield* canReadRepository(
                      envelope.repositoryId,
                    ).pipe(Effect.orElseSucceed(() => false))
                    return allowed ? envelope.event : undefined
                  }),
                ),
                Stream.filter(
                  (event): event is DecisionInboxStreamEvent =>
                    event !== undefined,
                ),
              )

              return Stream.concat(
                Stream.succeed<DecisionInboxStreamEvent>({
                  _tag: 'InboxSnapshotEvent',
                  revision: refreshedSnapshot.revision,
                  items: refreshedSnapshot.items,
                }),
                liveEvents,
              ).pipe(
                Stream.interruptWhen(
                  Effect.sleep(Duration.millis(remainingMs)),
                ),
              )
            }),
          )
        }),

        activeSubscriberCount,
        subscriberCountChanges,
      })
    }),
  )

export interface DecisionInboxBackendService {
  readonly listInbox: (
    caller: WorkOsAuthenticatedIdentity,
  ) => Effect.Effect<InboxSnapshot, InboxForbiddenError | InboxServerError>
  readonly canReadRepository: (input: {
    readonly caller: WorkOsAuthenticatedIdentity
    readonly repositoryId: RepositoryId
  }) => Effect.Effect<boolean, InboxServerError>
  readonly getAttemptDetail: (input: {
    readonly caller: WorkOsAuthenticatedIdentity
    readonly attemptId: VerificationAttemptId
  }) => Effect.Effect<
    AttemptDetail,
    InboxForbiddenError | InboxAttemptNotFoundError | InboxServerError
  >
  readonly submitDecision: (input: {
    readonly caller: WorkOsAuthenticatedIdentity
    readonly attemptId: VerificationAttemptId
    readonly payload: SubmitDecisionPayload
  }) => Effect.Effect<
    SubmitDecisionResponse,
    | InboxForbiddenError
    | InboxAttemptNotFoundError
    | InboxDecisionConflictError
    | InboxServerError
  >
}

export class DecisionInboxBackend extends Context.Service<
  DecisionInboxBackend,
  DecisionInboxBackendService
>()('@patchplane/server/DecisionInboxBackend') {}

export const DecisionInboxAuthMiddlewareLayer = Layer.effect(
  DecisionInboxAuthMiddleware,
  Effect.gen(function* () {
    const authenticator = yield* InboxCallerAuthenticator

    return DecisionInboxAuthMiddleware.of({
      bearer: Effect.fn('DecisionInboxAuthMiddleware.bearer')(function* (
        httpEffect,
        { credential },
      ) {
        const caller = yield* authenticator.authenticate(credential)
        const now = yield* Clock.currentTimeMillis
        if (caller.expiresAtMs <= now) {
          return yield* new InboxUnauthorizedError({
            message: 'Authenticated session has expired',
          })
        }
        yield* Effect.annotateCurrentSpan({
          principalId: caller.principalId,
          organizationId: caller.organizationId,
        })
        return yield* Effect.provideService(
          httpEffect,
          CurrentInboxCaller,
          caller,
        )
      }),
    })
  }),
)

export const DecisionInboxApiGroupLayer = HttpApiBuilder.group(
  DecisionInboxApi,
  'inbox',
  (handlers) =>
    Effect.gen(function* () {
      const backend = yield* DecisionInboxBackend
      const eventBus = yield* DecisionInboxEventBus

      return handlers
        .handle(
          'listInbox',
          Effect.fn('DecisionInboxApi.listInbox')(function* () {
            const caller = yield* CurrentInboxCaller
            const snapshot = yield* backend.listInbox(caller)
            yield* eventBus.syncRevisionFloor({
              organizationId: caller.organizationId,
              revision: snapshot.revision,
            })
            return snapshot
          }),
        )
        .handle(
          'getAttemptDetail',
          Effect.fn('DecisionInboxApi.getAttemptDetail')(function* ({
            params,
          }) {
            const caller = yield* CurrentInboxCaller
            return yield* backend.getAttemptDetail({
              caller,
              attemptId: params.attemptId,
            })
          }),
        )
        .handle(
          'submitDecision',
          Effect.fn('DecisionInboxApi.submitDecision')(function* ({
            params,
            payload,
          }) {
            const caller = yield* CurrentInboxCaller
            const response = yield* backend.submitDecision({
              caller,
              attemptId: params.attemptId,
              payload,
            })
            yield* eventBus.publish({
              organizationId: caller.organizationId,
              repositoryId: response.summary.repositoryId,
              buildEvent: (revision) => ({
                _tag: 'DecisionRecordedEvent',
                revision,
                decision: response.decision,
                summary: response.summary,
              }),
            })
            return response
          }),
        )
        .handle(
          'streamEvents',
          Effect.fn('DecisionInboxApi.streamEvents')(function* () {
            const caller = yield* CurrentInboxCaller
            return yield* eventBus.subscribeForCaller({
              caller,
              loadInitialSnapshot: backend.listInbox(caller),
              canReadRepository: (repositoryId) =>
                backend.canReadRepository({ caller, repositoryId }),
            })
          }),
        )
    }),
)

/**
 * Registers the typed Decision Inbox `HttpApi` (REST + SSE) with bearer
 * authentication middleware on the active `HttpRouter`.
 */
export const DecisionInboxHttpLayer = HttpApiBuilder.layer(
  DecisionInboxApi,
).pipe(
  Layer.provide(DecisionInboxApiGroupLayer),
  Layer.provide(DecisionInboxAuthMiddlewareLayer),
)
