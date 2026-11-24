import { describe, expect, it } from '@effect/vitest'
import { Data, Deferred, Effect, Layer, PubSub, Ref, Stream } from 'effect'
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
import { createDecisionInboxElement, DecisionInboxClient } from './index'

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

class ConditionTimeoutError extends Data.TaggedError('ConditionTimeoutError')<{
  readonly label: string
}> {}

const waitForCondition = (
  predicate: () => boolean,
  label: string,
): Effect.Effect<void, ConditionTimeoutError> =>
  Effect.gen(function* () {
    for (let i = 0; i < 60; i += 1) {
      if (predicate()) return undefined
      yield* Effect.sleep('10 millis')
    }
    return yield* new ConditionTimeoutError({ label })
  })

describe('Foldkit Runtime.embed + live SSE + React diff island lifecycle', () => {
  it.live(
    'mounts Foldkit runtime, updates DOM on live SSE events, mounts/unmounts React diff island, and interrupts SSE on disposal',
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

        const container = document.createElement('div')
        container.id = 'patchplane-inbox-test'
        document.body.appendChild(container)
        yield* Effect.addFinalizer(() => Effect.sync(() => container.remove()))

        const elementProgram = createDecisionInboxElement({
          container,
          clientLayer,
          streamEnabled: true,
        })
        const handle = yield* Effect.acquireRelease(
          Effect.sync(() => Runtime.embed(elementProgram)),
          (embedded) => Effect.promise(() => embedded.disposeAsync()),
        )

        // Wait for initial inbox load and live SSE subscription acquisition
        yield* Deferred.await(streamAcquired)
        yield* waitForCondition(
          () =>
            document.body.querySelector(
              `[data-testid="attempt-status-${ATTEMPT_LIVE}"]`,
            )?.textContent === 'running',
          'initial attempt status rendered',
        )
        expect(yield* Ref.get(activeStreams)).toBe(1)

        // Emit live SSE status update -> Foldkit updates DOM without polling or Convex
        yield* PubSub.publish(pubSub, {
          _tag: 'VerificationStatusChangedEvent',
          revision: 2,
          attemptId: ATTEMPT_LIVE,
          status: 'passed',
          generation: GEN_2,
          nextAction: 'Ready to approve',
          updatedAtMs: 1_700_000_010_000,
        })
        yield* waitForCondition(
          () =>
            document.body.querySelector(
              `[data-testid="attempt-status-${ATTEMPT_LIVE}"]`,
            )?.textContent === 'passed',
          'live SSE status update rendered',
        )

        // Click attempt -> Foldkit loads detail & mounts React diff viewer island via OnMount
        const selectBtn = document.body.querySelector(
          `[data-testid="select-attempt-${ATTEMPT_LIVE}"]`,
        )
        expect(selectBtn instanceof HTMLElement).toBe(true)
        if (selectBtn instanceof HTMLElement) {
          selectBtn.click()
        }

        yield* waitForCondition(
          () =>
            document.body.querySelector('[data-testid="react-diff-island"]') !==
            null,
          'React diff viewer island mounted inside Foldkit host',
        )

        // Interact inside React diff island -> typed event updates Foldkit view
        const focusFileBtn = document.body.querySelector(
          '[data-testid="focus-file-src/inbox.ts"]',
        )
        expect(focusFileBtn instanceof HTMLElement).toBe(true)
        if (focusFileBtn instanceof HTMLElement) {
          focusFileBtn.click()
        }

        yield* waitForCondition(
          () =>
            document.body.querySelector('[data-testid="focused-file"]')
              ?.textContent === 'Focused file: src/inbox.ts',
          'typed React diff island event received by Foldkit',
        )

        // Navigate back to inbox -> React diff island unmounts cleanly
        const backBtn = document.body.querySelector(
          '[data-testid="back-to-inbox"]',
        )
        expect(backBtn instanceof HTMLElement).toBe(true)
        if (backBtn instanceof HTMLElement) {
          backBtn.click()
        }

        yield* waitForCondition(
          () =>
            document.body.querySelector('[data-testid="react-diff-island"]') ===
            null,
          'React diff island unmounted on navigation back',
        )

        // Disposing the Foldkit runtime interrupts the SSE subscription and runs cleanup
        yield* Effect.promise(() => handle.disposeAsync())
        yield* Deferred.await(streamReleased)
        expect(yield* Ref.get(activeStreams)).toBe(0)
      }),
  )
})
