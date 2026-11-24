import * as Cloudflare from '@alchemy.run/cloudflare'
import { sanitizeErrorMessage } from '@patchplane/domain'
import { Effect } from 'effect'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import {
  CONTROL_PLANE_UNAVAILABLE,
  ControlPlaneContainer,
  ControlPlaneWakeError,
  type ControlPlaneWakeResult,
} from './control-plane-container'

/** Port where Alchemy's Bun `ControlPlaneContainer` serves its Effect HTTP router. */
export const CONTROL_PLANE_HTTP_PORT = 3000

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

export interface HttpForwardableContainerHandle<
  EStart = never,
  EPort = never,
  EFetch = never,
  RStart = never,
  RPort = never,
  RFetch = never,
> {
  readonly start: (options: {
    readonly enableInternet: boolean
  }) => Effect.Effect<unknown, EStart, RStart>
  readonly getTcpPort: (port: number) => Effect.Effect<
    {
      readonly fetch: (
        request: HttpServerRequest.HttpServerRequest,
      ) => Effect.Effect<HttpServerResponse.HttpServerResponse, EFetch, RFetch>
    },
    EPort,
    RPort
  >
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
            message: sanitizeErrorMessage(cause),
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
          error: CONTROL_PLANE_UNAVAILABLE,
        },
        { status: 503 },
      ),
    ),
  )
})

/**
 * Ensures the Bun Effect control-plane container is running and forwards the
 * inbound HTTP request (`/health`, `/api/v2/inbox/*`, `/mcp`) directly to its
 * port-3000 router. Startup or transport failures are logged with sanitized
 * causes and returned as an opaque `503` payload.
 */
export const forwardControlPlaneHttpRequest = Effect.fn(
  'ControlPlaneHost.forwardHttpRequest',
)(function* <EStart, EPort, EFetch, RStart, RPort, RFetch>(
  container: HttpForwardableContainerHandle<
    EStart,
    EPort,
    EFetch,
    RStart,
    RPort,
    RFetch
  >,
  request: HttpServerRequest.HttpServerRequest,
) {
  return yield* container.start({ enableInternet: true }).pipe(
    Effect.andThen(() => container.getTcpPort(CONTROL_PLANE_HTTP_PORT)),
    Effect.flatMap((port) => port.fetch(request)),
    Effect.mapError(
      (cause) =>
        new ControlPlaneWakeError({
          trigger: 'http',
          message: sanitizeErrorMessage(cause),
          cause,
        }),
    ),
    Effect.tapError((error) =>
      Effect.logError('ControlPlaneHost.fetch failed', {
        trigger: error.trigger,
        message: error.message,
      }),
    ),
    Effect.catchTag('ControlPlaneWakeError', (error) =>
      HttpServerResponse.json(
        {
          ok: false,
          trigger: error.trigger,
          error: CONTROL_PLANE_UNAVAILABLE,
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
      const request = yield* HttpServerRequest.HttpServerRequest
      return yield* forwardControlPlaneHttpRequest(container, request)
    })

    return Effect.succeed({
      wake: wakeContainer,
      fetch: handleFetch(),
    })
  }),
) {}
