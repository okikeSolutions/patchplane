import * as Cloudflare from '@alchemy.run/cloudflare'
import { Effect } from 'effect'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import {
  ControlPlaneContainer,
  ControlPlaneWakeError,
  type ControlPlaneWakeResult,
} from './control-plane-container'

export interface WakeableContainerHandle<
  EStart = never,
  EWake = never,
  RStart = never,
  RWake = never,
> {
  readonly start: (options: {
    readonly enableInternet: boolean
  }) => Effect.Effect<unknown, EStart, RStart>
  readonly wake: (
    trigger: string,
  ) => Effect.Effect<ControlPlaneWakeResult, EWake, RWake>
}

export const wakeControlPlaneContainer = Effect.fn(
  'ControlPlaneHost.wakeContainer',
)(function* <EStart, EWake, RStart, RWake>(
  container: WakeableContainerHandle<EStart, EWake, RStart, RWake>,
  trigger: string,
) {
  return yield* container.start({ enableInternet: true }).pipe(
    Effect.andThen(() => container.wake(trigger)),
    Effect.mapError((cause) =>
      cause instanceof ControlPlaneWakeError
        ? cause
        : new ControlPlaneWakeError({
            trigger,
            message: String(cause),
            cause,
          }),
    ),
    Effect.tapError((error) =>
      Effect.logError('ControlPlaneHost.wake failed', {
        trigger: error.trigger,
        message: error.message,
      }),
    ),
  )
})

export const handleWakeHttpResponse = Effect.fn(
  'ControlPlaneHost.handleWakeHttpResponse',
)(function* <R>(
  wake: Effect.Effect<ControlPlaneWakeResult, ControlPlaneWakeError, R>,
) {
  return yield* wake.pipe(
    Effect.flatMap((result) => HttpServerResponse.json(result)),
    Effect.catchTag('ControlPlaneWakeError', (error) =>
      HttpServerResponse.json(
        {
          ok: false,
          trigger: error.trigger,
          error: error.message,
        },
        { status: 503 },
      ),
    ),
  )
})

/**
 * Stateless fronting Durable Object required by Cloudflare Containers.
 * Holds zero Patchplane state: all workflow journals and acceptance state live in Postgres.
 */
export class ControlPlaneHost extends Cloudflare.Workers.DurableObject<ControlPlaneHost>()(
  'ControlPlaneHost',
  Effect.map(ControlPlaneContainer, (container) => {
    const wakeContainer = Effect.fn('ControlPlaneHost.wake')(function* (
      trigger: string,
    ) {
      return yield* wakeControlPlaneContainer(container, trigger)
    })

    const handleFetch = Effect.fn('ControlPlaneHost.fetch')(function* () {
      yield* HttpServerRequest.HttpServerRequest
      return yield* handleWakeHttpResponse(wakeContainer('http'))
    })

    return Effect.succeed({
      wake: wakeContainer,
      fetch: handleFetch(),
    })
  }),
) {}
