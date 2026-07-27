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
const sourceSentinel = 'PATCHPLANE_SOURCE_CONTENT_SENTINEL_31ce'
const rawSourceSentinel = `export const privateCustomerSource = '${sourceSentinel}'`
const rawPathSegmentSentinel = 'PATCHPLANE_RAW_PATH_SENTINEL_6a4e'
const rawPathSentinel = `src/private/${rawPathSegmentSentinel}/customer-secrets.ts`
const rawDiffSentinel = `diff --git a/${rawPathSentinel} b/${rawPathSentinel}
--- a/${rawPathSentinel}
+++ b/${rawPathSentinel}
@@ -1 +1 @@
-const privateValue = 'before'
+const privateValue = '${sentinel}'`

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
          data: {
            url: `/${rawPathSentinel}?token=${sentinel}`,
            from: rawPathSentinel,
            prompt: sentinel,
            selectedPath: rawPathSentinel,
            sourceExcerpt: rawSourceSentinel,
          },
        })
        Sentry.logger.info(`browser log ${sentinel}`, {
          telemetryPolicy: sentryTelemetryPolicyMarker,
          operation: 'browser.render',
          from: rawPathSentinel,
          prompt: sentinel,
          sourceExcerpt: rawSourceSentinel,
        })
        Sentry.metrics.count('patchplane.operation.count', 1, {
          attributes: {
            operation: 'browser.render',
            prompt: sentinel,
            sourceExcerpt: rawSourceSentinel,
            to: rawPathSentinel,
          },
        })
        Sentry.startSpan(
          {
            name: `/workspace/${rawPathSentinel}`,
            op: 'browser.render',
            attributes: {
              selectedPath: rawPathSentinel,
              sourceExcerpt: rawSourceSentinel,
            },
          },
          () => undefined,
        )
        Sentry.captureEvent({
          message: `browser failure ${sentinel}`,
          extra: {
            candidateDiff: rawDiffSentinel,
            sourceExcerpt: rawSourceSentinel,
          },
          exception: {
            values: [
              {
                type: 'BrowserFailure',
                value: sentinel,
                stacktrace: {
                  frames: [
                    {
                      filename: `/workspace/${rawPathSentinel}`,
                      context_line: rawSourceSentinel,
                      pre_context: [sourceSentinel],
                      post_context: [rawSourceSentinel],
                      vars: {
                        sourceExcerpt: rawSourceSentinel,
                        token: sentinel,
                      },
                    },
                  ],
                },
              },
            ],
          },
          request: {
            method: 'GET',
            url: `https://patchplane.example/${rawPathSentinel}?token=${sentinel}`,
            headers: { cookie: `session=${sentinel}` },
          },
          user: { email: `${sentinel}@example.com` },
        })
        const routeError = new Error(rawDiffSentinel)
        routeError.stack = [
          `Error: ${rawDiffSentinel}`,
          `    at renderDiff (/workspace/${rawPathSentinel}:42:7)`,
        ].join('\n')
        Sentry.captureException(routeError, {
          tags: { surface: 'client-router' },
          extra: {
            candidateDiff: rawDiffSentinel,
            selectedPath: rawPathSentinel,
          },
        })
        const sourceError = new Error(rawSourceSentinel)
        sourceError.stack = [
          `Error: ${rawSourceSentinel}`,
          `    at renderSource (/workspace/${rawPathSentinel}:7:3)`,
        ].join('\n')
        Sentry.captureException(sourceError, {
          tags: { surface: 'client-router' },
          extra: {
            sourceExcerpt: rawSourceSentinel,
            selectedPath: rawPathSentinel,
          },
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
        const serialized = JSON.stringify(envelopes)
        assert.ok(!serialized.includes(sentinel))
        assert.ok(!serialized.includes(rawSourceSentinel))
        assert.ok(!serialized.includes(sourceSentinel))
        assert.ok(!serialized.includes(rawDiffSentinel))
        assert.ok(!serialized.includes(rawPathSentinel))
        assert.ok(!serialized.includes(rawPathSegmentSentinel))
        assert.ok(!serialized.includes('customer-secrets.ts'))
        assert.ok(serialized.includes('/:path'))
      }).pipe(
        Effect.ensuring(
          Effect.promise(() => Sentry.close(2_000)).pipe(Effect.asVoid),
        ),
      )
    },
  )
})
