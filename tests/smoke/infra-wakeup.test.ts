import { describe, expect, it } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import {
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
import { VerificationAttemptWorkflowPayload } from '../../packages/core/src/index'
import {
  AttemptGeneration,
  ProposalVersion,
  sanitizeErrorMessage,
} from '../../packages/domain/src/index'

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

const WakeErrorResponseSchema = Schema.fromJsonString(
  Schema.Struct({
    ok: Schema.Literal(false),
    trigger: Schema.NonEmptyString,
    error: Schema.NonEmptyString,
  }),
)

describe('ControlPlaneHost and WakeupWorker behavior', () => {
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
    'surfaces ControlPlaneWakeError internally while returning an opaque 503 JSON error without leaking host details',
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

        const response = yield* handleWakeHttpResponse(wake)
        expect(response.status).toBe(503)
        const rawBody = readJsonBody(response)
        const parsed = yield* Schema.decodeEffect(WakeErrorResponseSchema)(
          rawBody,
        )
        expect(parsed.ok).toBe(false)
        expect(parsed.trigger).toBe('http')
        expect(rawBody).not.toContain('neon.tech')
        expect(rawBody).not.toContain('ECONNREFUSED')
      }),
  )

  it.effect('never wakes the control plane from an HTTP request', () =>
    Effect.gen(function* () {
      const response = yield* rejectHttpWake()
      expect(response.status).toBe(404)
    }),
  )

  it.effect(
    'fails scheduled cron wake visibly with ControlPlaneWakeError when wake fails or reports ok=false',
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
        expect(errorFailure.trigger).toBe('cron')

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
        expect(unhealthyFailure.trigger).toBe('cron')
      }),
  )

  it.effect(
    'strips URI credentials, password query params, and bearer tokens from error messages while preserving non-secret host context',
    () =>
      Effect.gen(function* () {
        const sanitized = sanitizeErrorMessage(
          new Error(
            'connect failed postgresql://neondb_owner:super-secret@ep-demo.neon.tech/neondb?password=leaked-pwd&sslmode=require with Bearer tok_secret_123',
          ),
        )
        expect(sanitized).not.toContain('super-secret')
        expect(sanitized).not.toContain('leaked-pwd')
        expect(sanitized).not.toContain('tok_secret_123')
        expect(sanitized).toContain('ep-demo.neon.tech')

        const wakeFailure = yield* Effect.flip(
          wakeControlPlaneContainer(
            {
              start: () =>
                Effect.fail(
                  'failed connecting to postgres://admin:p4ssw0rd@db.internal:5432/app',
                ),
              wake: (trigger) =>
                Effect.succeed({
                  ok: true,
                  trigger,
                  wokenAt: 0,
                } satisfies ControlPlaneWakeResult),
            },
            'cron',
          ),
        )
        expect(wakeFailure.message).not.toContain('p4ssw0rd')
        expect(wakeFailure.message).toContain('db.internal:5432')
      }),
  )

  it.effect(
    'enforces INT4 upper bounds and bounded workflow sleep durations at the schema boundary',
    () =>
      Effect.gen(function* () {
        const overflowGen = yield* Effect.flip(
          Schema.decodeEffect(AttemptGeneration)(2_147_483_648),
        )
        expect(overflowGen._tag).toBe('SchemaError')

        const overflowProposal = yield* Effect.flip(
          Schema.decodeEffect(ProposalVersion)(2_147_483_648),
        )
        expect(overflowProposal._tag).toBe('SchemaError')

        const unboundedSleep = yield* Effect.flip(
          Schema.decodeEffect(VerificationAttemptWorkflowPayload)({
            attemptId: 'attempt-1',
            changeRequestId: 'github:org/repo#1',
            initialGeneration: 1,
            waitDurationMs: 365 * 24 * 60 * 60 * 1000,
          }),
        )
        expect(unboundedSleep._tag).toBe('SchemaError')
      }),
  )
})
