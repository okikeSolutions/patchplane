import { Context, Effect, Layer, PubSub, Ref, Stream } from 'effect'
import { HttpServerRequest } from 'effect/http'
import { HttpApiBuilder } from 'effect/http-api'
import * as Redacted from 'effect/Redacted'
import {
  type AttemptDetail,
  DecisionInboxApi,
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
  type VerificationAttemptId,
  type WorkOsAuthenticatedIdentity,
} from '@patchplane/domain'

export interface InboxCallerAuthenticatorService {
  readonly authenticate: (
    bearerToken: Redacted.Redacted,
  ) => Effect.Effect<WorkOsAuthenticatedIdentity, InboxUnauthorizedError>
}

export class InboxCallerAuthenticator extends Context.Service<
  InboxCallerAuthenticator,
  InboxCallerAuthenticatorService
>()('@patchplane/server/InboxCallerAuthenticator') {}

export interface DecisionInboxEventBusService {
  readonly nextRevision: Effect.Effect<InboxRevision>
  readonly publish: (event: DecisionInboxStreamEvent) => Effect.Effect<void>
  readonly subscribe: (
    initialSnapshot?: InboxSnapshot,
  ) => Stream.Stream<DecisionInboxStreamEvent>
  readonly activeSubscriberCount: Effect.Effect<number>
}

export class DecisionInboxEventBus extends Context.Service<
  DecisionInboxEventBus,
  DecisionInboxEventBusService
>()('@patchplane/server/DecisionInboxEventBus') {}

export const DecisionInboxEventBusLive: Layer.Layer<DecisionInboxEventBus> =
  Layer.effect(
    DecisionInboxEventBus,
    Effect.gen(function* () {
      const pubSub = yield* PubSub.unbounded<DecisionInboxStreamEvent>()
      const activeSubscribers = yield* Ref.make(0)
      const revisionRef = yield* Ref.make(0)

      const subscribe: DecisionInboxEventBusService['subscribe'] = (
        initialSnapshot,
      ) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const subscription = yield* PubSub.subscribe(pubSub)
            yield* Effect.acquireRelease(
              Ref.update(activeSubscribers, (count) => count + 1),
              () =>
                Ref.update(activeSubscribers, (count) =>
                  count > 0 ? count - 1 : 0,
                ),
            )

            const liveStream = Stream.fromSubscription(subscription)
            if (initialSnapshot === undefined) {
              return liveStream
            }
            return Stream.concat(
              Stream.succeed<DecisionInboxStreamEvent>({
                _tag: 'InboxSnapshotEvent',
                revision: initialSnapshot.revision,
                items: initialSnapshot.items,
              }),
              liveStream,
            )
          }),
        )

      const nextRevision = Ref.updateAndGet(revisionRef, (n) => n + 1).pipe(
        Effect.withSpan('DecisionInboxEventBus.nextRevision'),
      )

      const activeSubscriberCount = Ref.get(activeSubscribers).pipe(
        Effect.withSpan('DecisionInboxEventBus.activeSubscriberCount'),
      )

      return DecisionInboxEventBus.of({
        nextRevision,

        publish: Effect.fn('DecisionInboxEventBus.publish')(function* (event) {
          yield* Ref.update(revisionRef, (current) =>
            event.revision > current ? event.revision : current,
          )
          yield* PubSub.publish(pubSub, event)
        }),

        subscribe,

        activeSubscriberCount,
      })
    }),
  )

export interface DecisionInboxBackendService {
  readonly listInbox: (
    caller: WorkOsAuthenticatedIdentity,
  ) => Effect.Effect<InboxSnapshot, InboxServerError>
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

const authenticateInboxRequest = Effect.fn(
  'DecisionInboxApi.authenticateRequest',
)(function* (
  authenticator: InboxCallerAuthenticatorService,
  request: HttpServerRequest.HttpServerRequest,
) {
  const token = extractBearerToken(request.headers.authorization)
  if (token === null) {
    return yield* new InboxUnauthorizedError({
      message: 'Missing or malformed bearer credential',
    })
  }
  const caller = yield* authenticator.authenticate(token)
  yield* Effect.annotateCurrentSpan({
    principalId: caller.principalId,
    organizationId: caller.organizationId,
  })
  return caller
})

export const DecisionInboxApiGroupLayer = HttpApiBuilder.group(
  DecisionInboxApi,
  'inbox',
  (handlers) =>
    Effect.gen(function* () {
      const authenticator = yield* InboxCallerAuthenticator
      const backend = yield* DecisionInboxBackend
      const eventBus = yield* DecisionInboxEventBus

      return handlers
        .handle(
          'listInbox',
          Effect.fn('DecisionInboxApi.listInbox')(function* ({ request }) {
            const caller = yield* authenticateInboxRequest(
              authenticator,
              request,
            )
            return yield* backend.listInbox(caller)
          }),
        )
        .handle(
          'getAttemptDetail',
          Effect.fn('DecisionInboxApi.getAttemptDetail')(function* ({
            params,
            request,
          }) {
            const caller = yield* authenticateInboxRequest(
              authenticator,
              request,
            )
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
            request,
          }) {
            const caller = yield* authenticateInboxRequest(
              authenticator,
              request,
            )
            const response = yield* backend.submitDecision({
              caller,
              attemptId: params.attemptId,
              payload,
            })
            const revision = yield* eventBus.nextRevision
            yield* eventBus.publish({
              _tag: 'DecisionRecordedEvent',
              revision,
              decision: response.decision,
              summary: response.summary,
            })
            return response
          }),
        )
        .handle(
          'streamEvents',
          Effect.fn('DecisionInboxApi.streamEvents')(function* ({ request }) {
            const caller = yield* authenticateInboxRequest(
              authenticator,
              request,
            )
            const snapshot = yield* backend.listInbox(caller)
            return eventBus.subscribe(snapshot)
          }),
        )
    }),
)

/**
 * Registers the typed Decision Inbox `HttpApi` (REST + SSE) on the active
 * `HttpRouter`.
 */
export const DecisionInboxHttpLayer = HttpApiBuilder.layer(
  DecisionInboxApi,
).pipe(Layer.provide(DecisionInboxApiGroupLayer))
