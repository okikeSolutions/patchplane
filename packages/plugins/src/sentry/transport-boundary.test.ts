import { assert, describe, it } from '@effect/vitest'
import {
  _INTERNAL_flushLogsBuffer,
  _INTERNAL_flushMetricsBuffer,
  type Envelope,
  type Transport,
} from '@sentry/core'
import * as Sentry from '@sentry/effect/server'
import { Effect } from 'effect'
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

const sentinel = 'PATCHPLANE_TRANSPORT_SENTINEL_SECRET_4d2c'

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

describe('Sentry transport boundary', () => {
  it.effect(
    'removes sensitive event content and retains the latest bounded breadcrumbs',
    () => {
      const envelopes: Array<Envelope> = []

      return Effect.gen(function* () {
        Sentry.init({
          dsn: 'https://public@example.com/1',
          defaultIntegrations: false,
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
        })

        for (let index = 0; index < 70; index += 1) {
          Sentry.addBreadcrumb({
            category:
              index === 69 ? 'patchplane.critical-path' : 'patchplane.workflow',
            message: `stage ${index} ${sentinel}`,
            data: {
              count: index,
              ...(index === 69
                ? {
                    criticalPathStage: 'verification',
                    status: 'failed',
                  }
                : {}),
              prompt: sentinel,
            },
          })
        }

        Sentry.logger.info(`runtime log ${sentinel}`, {
          telemetryPolicy: sentryTelemetryPolicyMarker,
          operation: 'runtime.execute',
          prompt: sentinel,
        })
        Sentry.metrics.count('patchplane.operation.count', 1, {
          attributes: { operation: 'runtime.execute', prompt: sentinel },
        })
        Sentry.startSpan(
          { name: `runtime span ${sentinel}`, op: 'runtime.execute' },
          () => undefined,
        )

        Sentry.captureEvent(
          {
            message: `provider failure ${sentinel}`,
            exception: {
              values: [
                {
                  type: 'RuntimeFailure',
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
            request: {
              method: 'POST',
              url: `https://patchplane.example/private?token=${sentinel}`,
              data: { webhookBody: sentinel },
              headers: { authorization: `Bearer ${sentinel}` },
            },
            extra: { prompt: sentinel },
          },
          {
            attachments: [
              {
                filename: 'evidence.txt',
                data: sentinel,
                contentType: 'text/plain',
              },
            ],
          },
        )

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
        assert.ok(itemTypes.includes('transaction'))

        const serialized = JSON.stringify(envelopes)
        assert.ok(!serialized.includes(sentinel))

        const event = envelopeItems(envelopes).find(
          ([header]) => header.type === 'event',
        )?.[1] as Record<string, unknown> | undefined
        assert.ok(event !== undefined)

        const breadcrumbs = event.breadcrumbs as
          | Array<{
              readonly category?: string
              readonly message?: string
              readonly data?: {
                readonly count?: number
                readonly criticalPathStage?: string
                readonly status?: string
              }
            }>
          | undefined
        assert.strictEqual(breadcrumbs?.length, 64)
        assert.strictEqual(breadcrumbs?.[0]?.data?.count, 6)
        assert.strictEqual(breadcrumbs?.at(-1)?.data?.count, 69)
        assert.strictEqual(
          breadcrumbs?.at(-1)?.category,
          'patchplane.critical-path',
        )
        assert.strictEqual(breadcrumbs?.at(-1)?.message, 'verification.failed')
        assert.deepStrictEqual(breadcrumbs?.at(-1)?.data, {
          count: 69,
          criticalPathStage: 'verification',
          status: 'failed',
        })
        assert.deepStrictEqual(event.request, {
          method: 'POST',
          url: 'https://patchplane.example/:path',
        })
        assert.ok(
          !envelopeItems(envelopes).some(
            ([header]) => header.type === 'attachment',
          ),
        )
      }).pipe(
        Effect.ensuring(
          Effect.promise(() => Sentry.close(2_000)).pipe(Effect.asVoid),
        ),
      )
    },
  )
})
