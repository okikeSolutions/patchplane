import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  CONTROL_PLANE_UNAVAILABLE,
  ControlPlaneWakeError,
  type ControlPlaneWakeResult,
} from '../../apps/infra/src/control-plane-container'
import {
  handleWakeHttpResponse,
  wakeControlPlaneContainer,
} from '../../apps/infra/src/control-plane-host'
import {
  rejectHttpWake,
  runScheduledWakeup,
} from '../../apps/infra/src/wakeup-worker'

const readJsonBody = (response: { readonly body: unknown }): string => {
  const body = response.body
  if (
    typeof body === 'object' &&
    body !== null &&
    Reflect.get(body, '_tag') === 'Uint8Array'
  ) {
    const bytes = Reflect.get(body, 'body')
    if (bytes instanceof Uint8Array) return new TextDecoder().decode(bytes)
  }
  return JSON.stringify(body)
}

describe('ControlPlaneHost and WakeupWorker error visibility', () => {
  it.effect('returns 200 JSON when container start and wake succeed', () =>
    Effect.gen(function* () {
      const wake = wakeControlPlaneContainer(
        {
          start: () => Effect.void,
          wake: (trigger) =>
            Effect.succeed({
              ok: true,
              trigger,
              wokenAt: 1_700_000_000_000,
            } satisfies ControlPlaneWakeResult),
        },
        'http',
      )

      const response = yield* handleWakeHttpResponse(wake)
      expect(response.status).toBe(200)
    }),
  )

  it.effect(
    'surfaces ControlPlaneWakeError internally but returns an opaque 503 body',
    () =>
      Effect.gen(function* () {
        const sensitiveCause =
          'connect ECONNREFUSED ep-secret-host.eu-central-1.aws.neon.tech:5432'
        const wake = wakeControlPlaneContainer(
          {
            start: () => Effect.fail(sensitiveCause),
            wake: (trigger) =>
              Effect.succeed({
                ok: true,
                trigger,
                wokenAt: 1_700_000_000_000,
              } satisfies ControlPlaneWakeResult),
          },
          'http',
        )

        const failure = yield* Effect.flip(wake)
        expect(failure._tag).toBe('ControlPlaneWakeError')
        expect(failure.trigger).toBe('http')
        expect(failure.message).toContain('ECONNREFUSED')

        const response = yield* handleWakeHttpResponse(wake)
        expect(response.status).toBe(503)
        const body = readJsonBody(response)
        expect(body).toContain(CONTROL_PLANE_UNAVAILABLE)
        expect(body).not.toContain('neon.tech')
        expect(body).not.toContain('ECONNREFUSED')
      }),
  )

  it.effect('never wakes the control plane from an HTTP request', () =>
    Effect.gen(function* () {
      const response = yield* rejectHttpWake()
      expect(response.status).toBe(404)
    }),
  )

  it.effect(
    'fails scheduled cron wake visibly when wake throws or returns ok=false',
    () =>
      Effect.gen(function* () {
        const errorFailure = yield* Effect.flip(
          runScheduledWakeup(() =>
            Effect.fail(
              new ControlPlaneWakeError({
                trigger: 'cron',
                message: 'postgres unavailable',
              }),
            ),
          ),
        )
        expect(errorFailure._tag).toBe('ControlPlaneWakeError')
        expect(errorFailure.message).toContain('postgres unavailable')

        const unhealthyFailure = yield* Effect.flip(
          runScheduledWakeup(() =>
            Effect.succeed({
              ok: false,
              trigger: 'cron',
              wokenAt: 0,
            }),
          ),
        )
        expect(unhealthyFailure._tag).toBe('ControlPlaneWakeError')
        expect(unhealthyFailure.message).toContain('ok=false')
      }),
  )
})
