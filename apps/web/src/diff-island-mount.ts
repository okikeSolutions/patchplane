import { Effect, Option, Queue, Schema, Stream } from 'effect'
import * as Mount from 'foldkit/mount'
import { DiffIslandEvent, DiffIslandViewData } from '@patchplane/contracts'
import { mountDiffViewerIsland } from './islands/diff-viewer-island'
import { InboxMessage } from './model'

const decodeIslandEvent = Schema.decodeUnknownOption(DiffIslandEvent)
const decodeFocusedFilePath = Schema.decodeUnknownOption(Schema.NonEmptyString)

const readFocusedFileAttribute = (element: Element): string | null => {
  const raw = element.getAttribute('data-focused-file')
  if (raw === null || raw.length === 0) return null
  return Option.getOrNull(decodeFocusedFilePath(raw))
}

/**
 * Foldkit `Mount.defineStream` bridge for the isolated React diff viewer island.
 *
 * Lifecycle guarantees:
 * - React root creation happens inside `Effect.acquireRelease`, so unmount or
 *   runtime disposal interrupts the stream fiber and synchronously calls
 *   `handle.unmount()`.
 * - Reactive view updates (such as `data-focused-file` patched by Foldkit's
 *   Snabbdom renderer) are forwarded to `handle.update(...)` via a scoped
 *   `MutationObserver` without remounting React or losing local UI state.
 * - Outgoing React callbacks are schema-validated (`DiffIslandEvent`), gated on
 *   Foldkit's `viewStateChanges` (`Live` vs `Paused`), and silenced on disposal.
 */
export const MountDiffViewerIsland = Mount.defineStream(
  'MountDiffViewerIsland',
  {
    args: {
      initialData: DiffIslandViewData,
    },
    messages: [
      InboxMessage.DiffIslandMounted,
      InboxMessage.DiffIslandEventReceived,
    ],
    execute: ({ element, initialData, viewStateChanges }) =>
      Stream.callback<
        | typeof InboxMessage.DiffIslandMounted.Type
        | typeof InboxMessage.DiffIslandEventReceived.Type
      >((queue) =>
        Effect.gen(function* () {
          // Gate interactions until the first ViewState arrives (fail-closed for Paused replay).
          let isLive = false
          let isDisposed = false

          const initialViewState = yield* Stream.runHead(
            Stream.take(viewStateChanges, 1),
          )
          isLive = Option.match(initialViewState, {
            onNone: () => true,
            onSome: (state) => state === 'Live',
          })

          yield* Effect.forkScoped(
            Stream.runForEach(viewStateChanges, (viewState) =>
              Effect.sync(() => {
                isLive = viewState === 'Live'
              }),
            ),
          )

          const islandHandle = yield* Effect.acquireRelease(
            Effect.sync(() =>
              mountDiffViewerIsland(element, initialData, (rawEvent) => {
                if (!isLive || isDisposed) return
                const decoded = decodeIslandEvent(rawEvent)
                if (Option.isSome(decoded)) {
                  Queue.offerUnsafe(
                    queue,
                    InboxMessage.DiffIslandEventReceived({
                      event: decoded.value,
                    }),
                  )
                }
              }),
            ),
            (handle) =>
              Effect.sync(() => {
                isDisposed = true
                handle.unmount()
              }),
          )

          // Observe reactive attribute patches written by Foldkit on the host node
          // and forward updated DiffIslandViewData into the mounted React root.
          if (typeof MutationObserver !== 'undefined') {
            yield* Effect.acquireRelease(
              Effect.sync(() => {
                const observer = new MutationObserver(() => {
                  if (isDisposed) return
                  islandHandle.update({
                    attemptId: initialData.attemptId,
                    proposalVersion: initialData.proposalVersion,
                    diffText: initialData.diffText,
                    focusedFilePath: readFocusedFileAttribute(element),
                  })
                })
                observer.observe(element, {
                  attributes: true,
                  attributeFilter: ['data-focused-file'],
                })
                return observer
              }),
              (observer) =>
                Effect.sync(() => {
                  observer.disconnect()
                }),
            )
          }

          if (isLive && !isDisposed) {
            Queue.offerUnsafe(
              queue,
              InboxMessage.DiffIslandMounted({
                attemptId: initialData.attemptId,
                proposalVersion: initialData.proposalVersion,
              }),
            )
          }

          return yield* Effect.never
        }),
      ),
  },
)
