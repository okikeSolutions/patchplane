import * as Cloudflare from '@alchemy.run/cloudflare'
import { Effect } from 'effect'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { ControlPlaneContainer } from './control-plane-container'

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
      return yield* container.start({ enableInternet: true }).pipe(
        Effect.andThen(() => container.wake(trigger)),
        Effect.orElseSucceed(() => ({
          ok: false,
          trigger,
          wokenAt: 0,
        })),
      )
    })

    return Effect.succeed({
      wake: wakeContainer,
      fetch: Effect.gen(function* () {
        yield* HttpServerRequest.HttpServerRequest
        const woke = yield* wakeContainer('http')
        return yield* HttpServerResponse.json(woke)
      }),
    })
  }),
) {}
