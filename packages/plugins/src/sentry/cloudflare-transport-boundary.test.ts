import { assert, describe, it } from '@effect/vitest'
import {
  _INTERNAL_flushLogsBuffer,
  _INTERNAL_flushMetricsBuffer,
  type Envelope,
  type Transport,
} from '@sentry/core'
import * as Sentry from '@sentry/cloudflare'
import { TelemetryService } from '@patchplane/core/services/telemetry-service'
import { Effect } from 'effect'
import { CloudflareTelemetryPlugin } from './CloudflareTelemetryPlugin'
import {
  makeSentryDataCollection,
  sanitizeSentryBreadcrumb,
  sanitizeSentryEvent,
  sanitizeSentryLog,
  sanitizeSentryMetric,
  sanitizeSentrySpan,
  sanitizeSentryTransaction,
  sentryMaxBreadcrumbs,
  sentryTelemetryPolicyMarker,
} from './sanitize'

const sentinel = 'PATCHPLANE_CLOUDFLARE_TRANSPORT_SENTINEL_7c3e'

type TestExecutionContext = {
  readonly waitUntil: (promise: Promise<unknown>) => void
  readonly passThroughOnException: () => void
}

type CollectedEnvelopeItem = readonly [
  Readonly<Record<string, unknown>>,
  unknown,
]

function envelopeItems(envelopes: ReadonlyArray<Envelope>) {
  return envelopes.flatMap(
    (envelope) => envelope[1] as unknown as Array<CollectedEnvelopeItem>,
  )
}

function collectingTransport(envelopes: Array<Envelope>): Transport {
  return {
    send: (envelope) => {
      envelopes.push(envelope)
      return Promise.resolve({ statusCode: 200 })
    },
    flush: () => Promise.resolve(true),
  }
}

describe('Cloudflare Sentry transport boundary', () => {
  it.effect(
    'does not transport request bodies or other sensitive payloads',
    () => {
      const envelopes: Array<Envelope> = []
      const pending: Array<Promise<unknown>> = []
      const handler = Sentry.withSentry(
        () => ({
          dsn: 'https://public@example.com/1',
          defaultIntegrations: false,
          integrations: [
            Sentry.httpServerIntegration({ maxRequestBodySize: 'none' }),
          ],
          transport: () => collectingTransport(envelopes),
          sendDefaultPii: false,
          dataCollection: makeSentryDataCollection(),
          maxBreadcrumbs: sentryMaxBreadcrumbs,
          enableLogs: true,
          enableMetrics: true,
          tracesSampleRate: 1,
          beforeSend: sanitizeSentryEvent,
          beforeSendTransaction: sanitizeSentryTransaction,
          beforeBreadcrumb: sanitizeSentryBreadcrumb,
          beforeSendLog: sanitizeSentryLog,
          beforeSendMetric: sanitizeSentryMetric,
          beforeSendSpan: sanitizeSentrySpan,
        }),
        {
          fetch: (
            _request: Request,
            _env: Record<string, never>,
            _context: TestExecutionContext,
          ) => {
            Sentry.addBreadcrumb({
              category: 'patchplane.worker',
              message: `worker request ${sentinel}`,
              data: { url: `/private?token=${sentinel}`, prompt: sentinel },
            })
            Sentry.logger.info(`worker log ${sentinel}`, {
              telemetryPolicy: sentryTelemetryPolicyMarker,
              operation: 'worker.fetch',
              prompt: sentinel,
            })
            Sentry.metrics.count('patchplane.operation.count', 1, {
              attributes: { operation: 'worker.fetch', prompt: sentinel },
            })
            Sentry.startSpan(
              {
                name: `worker span ${sentinel}`,
                op: 'worker.fetch',
                forceTransaction: true,
              },
              () => undefined,
            )
            Sentry.captureEvent({
              message: `worker failure ${sentinel}`,
              exception: {
                values: [
                  {
                    type: 'WorkerFailure',
                    value: sentinel,
                    stacktrace: {
                      frames: [
                        {
                          filename: `/private/${sentinel}.ts`,
                          context_line: sentinel,
                          pre_context: [sentinel],
                          post_context: [sentinel],
                          vars: { token: sentinel },
                        },
                      ],
                    },
                  },
                ],
              },
              extra: { providerResponseBody: sentinel },
            })
            return Promise.resolve(new Response('ok'))
          },
        },
      )

      return Effect.gen(function* () {
        const request = new Request(
          `https://patchplane.example/private?token=${sentinel}`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${sentinel}`,
            },
            body: JSON.stringify({ prompt: sentinel }),
          },
        )
        const context = {
          waitUntil: (promise: Promise<unknown>) => pending.push(promise),
          passThroughOnException: () => undefined,
        }

        yield* Effect.promise(() => handler.fetch(request, {}, context))
        yield* Effect.promise(() => Promise.all(pending))
        yield* Effect.sync(() => {
          const client = Sentry.getClient()
          assert.ok(client !== undefined)
          _INTERNAL_flushLogsBuffer(client)
          _INTERNAL_flushMetricsBuffer(client)
        })
        assert.strictEqual(
          yield* Effect.promise(() => Sentry.flush(2_000)),
          true,
        )

        const itemTypes = envelopeItems(envelopes).map(
          ([header]) => header.type,
        )
        assert.ok(itemTypes.includes('event'))
        assert.ok(itemTypes.includes('log'))
        assert.ok(itemTypes.includes('trace_metric'))
        assert.ok(
          itemTypes.includes('transaction') || itemTypes.includes('span'),
          `expected a span envelope, received: ${itemTypes.join(', ')}`,
        )
        assert.ok(!JSON.stringify(envelopes).includes(sentinel))
      }).pipe(
        Effect.ensuring(
          Effect.promise(() => Sentry.close(2_000)).pipe(Effect.asVoid),
        ),
      )
    },
  )

  it.effect(
    'flushes one sanitized handled capture from the request-owned client',
    () => {
      const envelopes: Array<Envelope> = []
      const pending: Array<Promise<unknown>> = []
      const handler = Sentry.withSentry(
        () => ({
          dsn: 'https://public@example.com/1',
          defaultIntegrations: false,
          transport: () => collectingTransport(envelopes),
          sendDefaultPii: false,
          dataCollection: makeSentryDataCollection(),
          tracesSampleRate: 1,
          beforeSend: sanitizeSentryEvent,
          beforeSendSpan: sanitizeSentrySpan,
        }),
        {
          fetch: (
            _request: Request,
            _env: Record<string, never>,
            _context: TestExecutionContext,
          ) =>
            Effect.gen(function* () {
              const telemetry = yield* TelemetryService
              yield* telemetry.withSpan(
                {
                  name: 'patchplane.worker.fetch',
                  operation: 'worker.fetch',
                },
                telemetry.captureError({
                  operation: 'worker.fetch',
                  error: new Error(sentinel),
                }),
              )
              return new Response('handled')
            }).pipe(
              Effect.provide(CloudflareTelemetryPlugin.layer),
              Effect.runPromise,
            ),
        },
      )

      return Effect.gen(function* () {
        yield* Effect.promise(() =>
          handler.fetch(
            new Request('https://patchplane.example/handled'),
            {},
            {
              waitUntil: (promise) => pending.push(promise),
              passThroughOnException: () => undefined,
            },
          ),
        )
        yield* Effect.promise(() => Promise.all(pending))

        const events = envelopeItems(envelopes).filter(
          ([header]) => header.type === 'event',
        )
        assert.strictEqual(events.length, 1)
        assert.ok(
          envelopeItems(envelopes).some(
            ([header]) =>
              header.type === 'span' || header.type === 'transaction',
          ),
        )
        assert.ok(!JSON.stringify(envelopes).includes(sentinel))
      }).pipe(
        Effect.ensuring(
          Effect.promise(() => Sentry.close(2_000)).pipe(Effect.asVoid),
        ),
      )
    },
  )
})
