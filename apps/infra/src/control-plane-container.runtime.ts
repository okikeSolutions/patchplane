import * as Neon from '@alchemy.run/neon'
import { Clock, Effect } from 'effect'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import * as Redacted from 'effect/Redacted'
import { ControlPlaneContainer } from './control-plane-container'
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

    const handleFetch = Effect.fn('ControlPlaneContainer.fetch')(function* () {
      const connectionString: Redacted.Redacted =
        yield* db.pooledConnectionString
      const wokenAt = yield* Clock.currentTimeMillis
      return yield* HttpServerResponse.json({
        status: 'ok',
        runtime: 'bun',
        databaseBound: Redacted.isRedacted(connectionString),
        wokenAt,
      })
    })

    const fetchEffect = handleFetch()

    return ControlPlaneContainer.of({
      wake: Effect.fn('ControlPlaneContainer.wake')(function* (
        trigger: string,
      ) {
        const wokenAt = yield* Clock.currentTimeMillis
        return {
          ok: true,
          trigger,
          wokenAt,
        }
      }),
      fetch: fetchEffect,
    })
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- Container runtime entry point (main: import.meta.url)
  }).pipe(Effect.provide(Neon.ConnectHttp)),
)
