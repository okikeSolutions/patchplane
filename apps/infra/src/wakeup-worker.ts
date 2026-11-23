import * as Cloudflare from '@alchemy.run/cloudflare'
import { Effect } from 'effect'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { ControlPlaneHost } from './control-plane-host'

/**
 * Stateless scheduled Worker that wakes the Bun Effect container on a fixed interval
 * so durable timers stored in Postgres resume even after container inactivity sleep.
 */
export class WakeupWorker extends Cloudflare.Workers.Worker<WakeupWorker>()(
  'WakeupWorker',
  {
    main: import.meta.url,
  },
  Effect.gen(function* () {
    const host = yield* ControlPlaneHost

    yield* Cloudflare.Workers.cron('*/15 * * * *', () =>
      host.getByName('primary').wake('cron').pipe(Effect.asVoid),
    )

    return {
      fetch: Effect.gen(function* () {
        const result = yield* host.getByName('primary').wake('http')
        return yield* HttpServerResponse.json(result)
      }),
    }
  }).pipe(Effect.provide(Cloudflare.Workers.CronEventSourceLive)),
) {}

export default WakeupWorker
