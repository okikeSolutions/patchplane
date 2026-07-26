// @vitest-environment jsdom

import { assert, describe, it } from '@effect/vitest'
import {
  _INTERNAL_flushLogsBuffer,
  _INTERNAL_flushMetricsBuffer,
  type Envelope,
  type Transport,
} from '@sentry/core'
import * as Sentry from '@sentry/react'
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
} from '@patchplane/plugins/sentry/sanitize'
import { Effect } from 'effect'

const sentinel = 'PATCHPLANE_BROWSER_TRANSPORT_SENTINEL_8b1a'

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

describe('browser Sentry transport boundary', () => {
  it.effect(
    'sanitizes browser events, breadcrumbs, logs, metrics, and spans',
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

        Sentry.addBreadcrumb({
          category: 'ui.click',
          message: `clicked ${sentinel}`,
          data: { url: `/private?token=${sentinel}`, prompt: sentinel },
        })
        Sentry.logger.info(`browser log ${sentinel}`, {
          telemetryPolicy: sentryTelemetryPolicyMarker,
          operation: 'browser.render',
          prompt: sentinel,
        })
        Sentry.metrics.count('patchplane.operation.count', 1, {
          attributes: { operation: 'browser.render', prompt: sentinel },
        })
        Sentry.startSpan(
          { name: `browser span ${sentinel}`, op: 'browser.render' },
          () => undefined,
        )
        Sentry.captureEvent({
          message: `browser failure ${sentinel}`,
          exception: {
            values: [
              {
                type: 'BrowserFailure',
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
            method: 'GET',
            url: `https://patchplane.example/private?token=${sentinel}`,
            headers: { cookie: `session=${sentinel}` },
          },
          user: { email: `${sentinel}@example.com` },
        })

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
        assert.ok(!JSON.stringify(envelopes).includes(sentinel))
      }).pipe(
        Effect.ensuring(
          Effect.promise(() => Sentry.close(2_000)).pipe(Effect.asVoid),
        ),
      )
    },
  )
})
