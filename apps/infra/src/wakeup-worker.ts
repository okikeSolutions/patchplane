import * as Cloudflare from '@alchemy.run/cloudflare'
import { Effect } from 'effect'
import {
  ControlPlaneWakeError,
  type ControlPlaneWakeResult,
} from './control-plane-container'
import { ControlPlaneHost, handleWakeHttpResponse } from './control-plane-host'

export const runScheduledWakeup = Effect.fn('WakeupWorker.cron')(function* <
  E,
  R,
>(wake: () => Effect.Effect<ControlPlaneWakeResult, E, R>) {
  const result = yield* wake().pipe(
    Effect.mapError((cause) =>
      cause instanceof ControlPlaneWakeError
        ? cause
        : new ControlPlaneWakeError({
            trigger: 'cron',
            message: String(cause),
            cause,
          }),
    ),
    Effect.tapError((error) =>
      Effect.logError('WakeupWorker.cron failed', {
        trigger: error.trigger,
        message: error.message,
      }),
    ),
  )

  if (!result.ok) {
    const error = new ControlPlaneWakeError({
      trigger: result.trigger,
      message: 'Control plane wake returned ok=false',
    })
    yield* Effect.logError('WakeupWorker.cron unhealthy wake', {
      trigger: error.trigger,
      message: error.message,
    })
    return yield* error
  }

  return result
})

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
      runScheduledWakeup(() => host.getByName('primary').wake('cron')).pipe(
        Effect.asVoid,
      ),
    )

    const handleFetch = Effect.fn('WakeupWorker.fetch')(function* () {
      return yield* handleWakeHttpResponse(
        host
          .getByName('primary')
          .wake('http')
          .pipe(
            Effect.mapError((cause) =>
              cause instanceof ControlPlaneWakeError
                ? cause
                : new ControlPlaneWakeError({
                    trigger: 'http',
                    message: String(cause),
                    cause,
                  }),
            ),
            Effect.tapError((error) =>
              Effect.logError('WakeupWorker.fetch failed', {
                trigger: error.trigger,
                message: error.message,
              }),
            ),
          ),
      )
    })

    return {
      fetch: handleFetch(),
    }
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- Alchemy Worker entry point
  }).pipe(Effect.provide(Cloudflare.Workers.CronEventSourceLive)),
) {}

export default WakeupWorker
