import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  ControlPlaneWakeError,
  type ControlPlaneWakeResult,
} from '../../apps/infra/src/control-plane-container'
import {
  handleWakeHttpResponse,
  wakeControlPlaneContainer,
} from '../../apps/infra/src/control-plane-host'
import { runScheduledWakeup } from '../../apps/infra/src/wakeup-worker'

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
    'surfaces ControlPlaneWakeError and returns 503 when container start fails',
    () =>
      Effect.gen(function* () {
        const wake = wakeControlPlaneContainer(
          {
            start: () => Effect.fail('container boot timeout'),
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
        expect(failure.message).toContain('container boot timeout')

        const response = yield* handleWakeHttpResponse(wake)
        expect(response.status).toBe(503)
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
