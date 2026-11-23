import * as Neon from '@alchemy.run/neon'
import { Effect } from 'effect'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import type * as Redacted from 'effect/Redacted'
import {
  makeControlPlaneSingleStoreLayer,
  wakeControlPlane,
} from '@patchplane/server'
import {
  ControlPlaneContainer,
  ControlPlaneWakeError,
} from './control-plane-container'
import { PatchplaneDb } from './resources'

export default ControlPlaneContainer.make(
  {
    main: import.meta.url,
    runtime: 'bun',
    instanceType: 'lite',
    maxInstances: 1,
  },
  Effect.gen(function* () {
    const db = yield* Neon.Connect(PatchplaneDb)

    const runWakeAgainstPostgres = Effect.fn(
      'ControlPlaneContainer.runWakeAgainstPostgres',
    )(function* (trigger: string) {
      const connectionString: Redacted.Redacted =
        yield* db.pooledConnectionString
      const singleStoreLayer = makeControlPlaneSingleStoreLayer({
        url: connectionString,
        maxConnections: 5,
        entityMailboxPollIntervalMs: 250,
      })

      const result = yield* wakeControlPlane().pipe(
        // oxlint-disable-next-line effecttsgo/strict-effect-provide -- Scoped per-wake single-store runtime inside container entrypoint
        Effect.provide(singleStoreLayer),
        Effect.mapError(
          (cause) =>
            new ControlPlaneWakeError({
              trigger,
              message: String(cause),
              cause,
            }),
        ),
      )

      return {
        ok: result.ok,
        trigger,
        wokenAt: result.wokenAt,
      }
    })

    const handleFetch = Effect.fn('ControlPlaneContainer.fetch')(function* () {
      const woken = yield* runWakeAgainstPostgres('http')
      return yield* HttpServerResponse.json({
        status: woken.ok ? 'ok' : 'degraded',
        runtime: 'bun',
        wokenAt: woken.wokenAt,
      })
    })

    const fetchEffect = handleFetch().pipe(
      Effect.catchTag('ControlPlaneWakeError', (error) =>
        Effect.logError('ControlPlaneContainer.fetch failed', {
          trigger: error.trigger,
          message: error.message,
        }).pipe(
          Effect.andThen(
            HttpServerResponse.json(
              {
                status: 'error',
                runtime: 'bun',
                message: error.message,
              },
              { status: 503 },
            ),
          ),
        ),
      ),
    )

    return ControlPlaneContainer.of({
      wake: Effect.fn('ControlPlaneContainer.wake')(function* (
        trigger: string,
      ) {
        return yield* runWakeAgainstPostgres(trigger)
      }),
      fetch: fetchEffect,
    })
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- Container runtime entry point (main: import.meta.url)
  }).pipe(Effect.provide(Neon.ConnectHttp)),
)
