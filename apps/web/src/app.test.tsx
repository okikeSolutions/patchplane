import { describe, expect, it } from '@effect/vitest'
import {
  Data,
  Deferred,
  Effect,
  Exit,
  Layer,
  PubSub,
  Ref,
  Scope,
  Stream,
} from 'effect'
import * as Runtime from 'foldkit/runtime'
import type {
  AttemptDetail,
  AttemptSummary,
  DecisionInboxStreamEvent,
} from '@patchplane/contracts'
import {
  ActorId,
  AttemptGeneration,
  ChangeRequestId,
  DecisionId,
  ProposalVersion,
  RepositoryId,
  VerificationAttemptId,
} from '@patchplane/domain'
import {
  createDecisionInboxApp,
  createDecisionInboxElement,
  DecisionInboxClient,
} from './index'

const ATTEMPT_LIVE = VerificationAttemptId.make('att-live-dom-1')
const CR_LIVE = ChangeRequestId.make('pr-900')
const REPO = RepositoryId.make('okikeSolutions/patchplane')
const VERSION_1 = ProposalVersion.make(1)
const GEN_1 = AttemptGeneration.make(1)
const GEN_2 = AttemptGeneration.make(2)

const LIVE_DIFF = [
  '--- a/src/inbox.ts',
  '+++ b/src/inbox.ts',
  '@@ -1,1 +1,2 @@',
  ' export const ready = true',
  '+export const foldkitMounted = true',
].join('\n')

class DisposeError extends Data.TaggedError('DisposeError')<{
  readonly cause: unknown
}> {}

/**
 * Deterministically awaits a DOM predicate using MutationObserver + Deferred
 * (zero wall-clock polling loops).
 */
const awaitDomMutation = (
  root: Node,
  predicate: () => boolean,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (predicate()) return
    const done = yield* Deferred.make<void>()
    yield* Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            const observer = new MutationObserver(() => {
              if (predicate()) {
                Deferred.doneUnsafe(done, Exit.void)
              }
            })
            observer.observe(root, {
              childList: true,
              subtree: true,
              attributes: true,
              characterData: true,
            })
            if (predicate()) {
              Deferred.doneUnsafe(done, Exit.void)
            }
            return observer
          }),
          (observer) => Effect.sync(() => observer.disconnect()),
        )
        yield* Deferred.await(done)
      }),
    )
  })

describe('Foldkit Runtime.embed + live SSE + React diff island lifecycle', () => {
  it.live(
    'mounts Foldkit element without mutating history, updates DOM on live SSE, propagates React diff island props, unmounts cleanly, and interrupts SSE on disposal',
    () =>
      Effect.gen(function* () {
        const pubSub = yield* PubSub.unbounded<DecisionInboxStreamEvent>()
        const streamAcquired = yield* Deferred.make<void>()
        const streamReleased = yield* Deferred.make<void>()
        const activeStreams = yield* Ref.make(0)

        const initialSummary: AttemptSummary = {
          attemptId: ATTEMPT_LIVE,
          changeRequestId: CR_LIVE,
          repositoryId: REPO,
          title: 'Foldkit live runtime proof',
          status: 'running',
          generation: GEN_1,
          proposalVersion: VERSION_1,
          nextAction: 'Waiting for cloud checks',
          updatedAtMs: 1_700_000_000_000,
        }

        const initialDetail: AttemptDetail = {
          revision: 1,
          summary: initialSummary,
          diffText: LIVE_DIFF,
          files: [
            {
              path: 'src/inbox.ts',
              hunkCount: 1,
              additions: 1,
              deletions: 0,
            },
          ],
          decision: null,
        }

        const clientLayer = Layer.succeed(
          DecisionInboxClient,
          DecisionInboxClient.of({
            listInbox: Effect.succeed({
              revision: 1,
              items: [initialSummary],
            }),
            getAttemptDetail: () => Effect.succeed(initialDetail),
            submitDecision: ({ attemptId, payload }) =>
              Effect.succeed({
                decision: {
                  id: DecisionId.make('dec-live-1'),
                  attemptId,
                  proposalVersion: payload.proposalVersion,
                  kind: payload.kind,
                  actorId: ActorId.make('maintainer-live'),
                },
                summary: {
                  attemptId: initialSummary.attemptId,
                  changeRequestId: initialSummary.changeRequestId,
                  repositoryId: initialSummary.repositoryId,
                  title: initialSummary.title,
                  status: 'passed',
                  generation: GEN_2,
                  proposalVersion: VERSION_1,
                  nextAction: 'Approved',
                  updatedAtMs: 1_700_000_020_000,
                },
              }),
            openEventStream: Effect.succeed(
              Stream.unwrap(
                Effect.gen(function* () {
                  const subscription = yield* PubSub.subscribe(pubSub)
                  yield* Effect.acquireRelease(
                    Effect.gen(function* () {
                      yield* Ref.update(activeStreams, (n) => n + 1)
                      yield* Deferred.succeed(streamAcquired, undefined)
                    }),
                    () =>
                      Effect.gen(function* () {
                        yield* Ref.update(activeStreams, (n) =>
                          n > 0 ? n - 1 : 0,
                        )
                        yield* Deferred.succeed(streamReleased, undefined)
                      }),
                  )
                  return Stream.fromSubscription(subscription)
                }),
              ),
            ),
          }),
        )

        const hostWrapper = document.createElement('div')
        const container = document.createElement('div')
        container.id = 'patchplane-inbox-element-test'
        hostWrapper.appendChild(container)
        document.body.appendChild(hostWrapper)
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => hostWrapper.remove()),
        )

        const initialPath = window.location.pathname

        const runtimeScope = yield* Scope.make()
        const elementProgram = createDecisionInboxElement({
          container,
          clientLayer,
          streamEnabled: true,
        })
        yield* Effect.acquireRelease(
          Effect.sync(() => Runtime.embed(elementProgram)),
          (embedded) =>
            Effect.tryPromise({
              try: () => embedded.disposeAsync(),
              catch: (cause) => new DisposeError({ cause }),
            }).pipe(Effect.ignore),
        ).pipe(Scope.provide(runtimeScope))

        // Wait for initial inbox load and live SSE subscription acquisition
        yield* Deferred.await(streamAcquired)
        yield* awaitDomMutation(
          hostWrapper,
          () =>
            hostWrapper.querySelector(
              `[data-testid="attempt-status-${ATTEMPT_LIVE}"]`,
            )?.textContent === 'running',
        )
        expect(yield* Ref.get(activeStreams)).toBe(1)

        // Emit live SSE status update -> Foldkit updates DOM without polling or Convex
        yield* PubSub.publish(pubSub, {
          _tag: 'VerificationStatusChangedEvent',
          revision: 2,
          attemptId: ATTEMPT_LIVE,
          repositoryId: REPO,
          status: 'passed',
          generation: GEN_2,
          nextAction: 'Ready to approve',
          updatedAtMs: 1_700_000_010_000,
        })
        yield* awaitDomMutation(
          hostWrapper,
          () =>
            hostWrapper.querySelector(
              `[data-testid="attempt-status-${ATTEMPT_LIVE}"]`,
            )?.textContent === 'passed',
        )

        // Click attempt -> Foldkit loads detail & mounts React diff viewer island via OnMount
        const selectBtn = hostWrapper.querySelector(
          `[data-testid="select-attempt-${ATTEMPT_LIVE}"]`,
        )
        expect(selectBtn instanceof HTMLElement).toBe(true)
        if (selectBtn instanceof HTMLElement) {
          selectBtn.click()
        }

        yield* awaitDomMutation(
          hostWrapper,
          () =>
            hostWrapper.querySelector('[data-testid="react-diff-island"]') !==
            null,
        )

        // createDecisionInboxElement must not mutate browser URL history
        expect(window.location.pathname).toBe(initialPath)

        // Interact inside React diff island -> Foldkit updates focusedFilePath AND
        // propagates data-focused="true" back into the live mounted React diff island!
        const focusFileBtn = hostWrapper.querySelector(
          '[data-testid="focus-file-src/inbox.ts"]',
        )
        expect(focusFileBtn instanceof HTMLElement).toBe(true)
        if (focusFileBtn instanceof HTMLElement) {
          focusFileBtn.click()
        }

        yield* awaitDomMutation(
          hostWrapper,
          () =>
            hostWrapper.querySelector('[data-testid="focused-file"]')
              ?.textContent === 'Focused file: src/inbox.ts' &&
            hostWrapper
              .querySelector('[data-testid="diff-file-src/inbox.ts"]')
              ?.getAttribute('data-focused') === 'true',
        )

        // Navigate back to inbox -> React diff island unmounts cleanly
        const backBtn = hostWrapper.querySelector(
          '[data-testid="back-to-inbox"]',
        )
        expect(backBtn instanceof HTMLElement).toBe(true)
        if (backBtn instanceof HTMLElement) {
          backBtn.click()
        }

        yield* awaitDomMutation(
          hostWrapper,
          () =>
            hostWrapper.querySelector('[data-testid="react-diff-island"]') ===
            null,
        )

        // Closing the inner Scope disposes Foldkit runtime once and tears down SSE cleanly
        yield* Scope.close(runtimeScope, Exit.void)
        yield* Deferred.await(streamReleased)
        expect(yield* Ref.get(activeStreams)).toBe(0)
      }),
  )

  it.live(
    'drives full URL routing in createDecisionInboxApp without routing to NotFound or duplicating detail fetches',
    () =>
      Effect.gen(function* () {
        const detailFetchCount = yield* Ref.make(0)
        const initialSummary: AttemptSummary = {
          attemptId: ATTEMPT_LIVE,
          changeRequestId: CR_LIVE,
          repositoryId: REPO,
          title: 'Routed Foldkit proof',
          status: 'passed',
          generation: GEN_1,
          proposalVersion: VERSION_1,
          nextAction: 'Review diff',
          updatedAtMs: 1_700_000_000_000,
        }
        const initialDetail: AttemptDetail = {
          revision: 1,
          summary: initialSummary,
          diffText: LIVE_DIFF,
          files: [],
          decision: null,
        }

        const clientLayer = Layer.succeed(
          DecisionInboxClient,
          DecisionInboxClient.of({
            listInbox: Effect.succeed({
              revision: 1,
              items: [initialSummary],
            }),
            getAttemptDetail: () =>
              Ref.updateAndGet(detailFetchCount, (n) => n + 1).pipe(
                Effect.as(initialDetail),
              ),
            submitDecision: () => Effect.die('unused'),
            openEventStream: Effect.succeed(Stream.empty),
          }),
        )

        window.history.replaceState({}, '', '/')
        const hostWrapper = document.createElement('div')
        const container = document.createElement('div')
        container.id = 'patchplane-inbox-app-routing-test'
        hostWrapper.appendChild(container)
        document.body.appendChild(hostWrapper)
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            hostWrapper.remove()
            window.history.replaceState({}, '', '/')
          }),
        )

        const appProgram = createDecisionInboxApp({
          container,
          clientLayer,
          streamEnabled: false,
        })
        yield* Effect.acquireRelease(
          Effect.sync(() => Runtime.embed(appProgram)),
          (embedded) =>
            Effect.tryPromise({
              try: () => embedded.disposeAsync(),
              catch: (cause) => new DisposeError({ cause }),
            }).pipe(Effect.ignore),
        )

        yield* awaitDomMutation(
          hostWrapper,
          () =>
            hostWrapper.querySelector(
              `[data-testid="select-attempt-${ATTEMPT_LIVE}"]`,
            ) !== null,
        )

        const selectBtn = hostWrapper.querySelector(
          `[data-testid="select-attempt-${ATTEMPT_LIVE}"]`,
        )
        if (selectBtn instanceof HTMLElement) {
          selectBtn.click()
        }

        yield* awaitDomMutation(
          hostWrapper,
          () =>
            hostWrapper.querySelector(
              '[data-testid="attempt-detail-panel"]',
            ) !== null,
        )

        // Must land on AttemptDetail URL (not NotFound) and fetch detail exactly once
        expect(window.location.pathname).toBe(`/attempts/${ATTEMPT_LIVE}`)
        expect(
          hostWrapper.querySelector('[data-testid="route-not-found"]'),
        ).toBeNull()
        expect(yield* Ref.get(detailFetchCount)).toBe(1)
      }),
  )
})
