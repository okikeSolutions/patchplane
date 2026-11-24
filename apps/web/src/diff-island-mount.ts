import { Effect, Option, Queue, Schema, Stream } from 'effect'
import * as Mount from 'foldkit/mount'
import { DiffIslandEvent, DiffIslandViewData } from '@patchplane/contracts'
import { mountDiffViewerIsland } from './islands/diff-viewer-island'
import { InboxMessage } from './model'

const decodeIslandEvent = Schema.decodeUnknownOption(DiffIslandEvent)

/**
 * Foldkit `Mount.defineStream` bridge for the isolated React diff viewer island.
 *
 * Lifecycle guarantees:
 * - React root creation happens inside `Effect.acquireRelease`, so unmount or
 *   runtime disposal interrupts the stream fiber and synchronously calls
 *   `handle.unmount()`.
 * - Outgoing React callbacks are validated with `DiffIslandEvent` schema and
 *   gated on Foldkit's `viewStateChanges` (`Live` vs `Paused`).
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
          let isLive = true

          yield* Effect.forkScoped(
            Stream.runForEach(viewStateChanges, (viewState) =>
              Effect.sync(() => {
                isLive = viewState === 'Live'
              }),
            ),
          )

          yield* Effect.acquireRelease(
            Effect.sync(() =>
              mountDiffViewerIsland(element, initialData, (rawEvent) => {
                if (!isLive) return
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
                handle.unmount()
              }),
          )

          Queue.offerUnsafe(
            queue,
            InboxMessage.DiffIslandMounted({
              attemptId: initialData.attemptId,
            }),
          )

          return yield* Effect.never
        }),
      ),
  },
)
