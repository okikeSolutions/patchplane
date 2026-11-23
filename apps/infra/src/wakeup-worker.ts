import * as Cloudflare from '@alchemy.run/cloudflare'
import { Effect } from 'effect'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import {
  ControlPlaneWakeError,
  type ControlPlaneWakeResult,
} from './control-plane-container'
import { ControlPlaneHost } from './control-plane-host'

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
 * HTTP never wakes the control plane: an unauthenticated route that starts a
 * container and opens Postgres connections is a cost and DoS amplifier.
 */
export const rejectHttpWake = Effect.fn('WakeupWorker.fetch')(function* () {
  return yield* HttpServerResponse.json({ error: 'not_found' }, { status: 404 })
})

/**
 * Stateless scheduled Worker that wakes the Bun Effect container on a fixed interval
 * so durable timers stored in Postgres resume even after container inactivity sleep.
 * It has no public route (`workersDev: false`); the cron trigger is its only entry.
 */
export class WakeupWorker extends Cloudflare.Workers.Worker<WakeupWorker>()(
  'WakeupWorker',
  {
    main: import.meta.url,
    workersDev: false,
  },
  Effect.gen(function* () {
    const host = yield* ControlPlaneHost

    yield* Cloudflare.Workers.cron('*/15 * * * *', () =>
      runScheduledWakeup(() => host.getByName('primary').wake('cron')).pipe(
        Effect.asVoid,
      ),
    )

    return {
      fetch: rejectHttpWake(),
    }
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- Alchemy Worker entry point
  }).pipe(Effect.provide(Cloudflare.Workers.CronEventSourceLive)),
) {}

export default WakeupWorker
