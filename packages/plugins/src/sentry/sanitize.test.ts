import { assert, describe, it } from '@effect/vitest'
import type {
  Breadcrumb,
  ErrorEvent,
  Log,
  Metric,
  SpanJSON,
} from '@sentry/core'
import { Array as EffectArray } from 'effect'
import {
  sanitizeSentryBreadcrumb,
  sanitizeSentryEvent,
  sanitizeSentryLog,
  sanitizeSentryMetric,
  sanitizeSentrySpan,
  sanitizeSentryTransaction,
  sanitizeTelemetryUrl,
  sentryTelemetryPolicyMarker,
} from './sanitize'

const sentinel = 'PATCHPLANE_SENTINEL_SECRET_9f7e'
const bearer = `Bearer ${sentinel}`
const sentryTraceId = '0123456789abcdef0123456789abcdef'
const sentrySpanId = '0123456789abcdef'
const telemetryTraceId = '01234567-89ab-cdef-0123-456789abcdef'
const recordId = 'ms76g9ahz6hbsr31xbynkz5pa58b7c68'

function serialized(value: unknown): string {
  return JSON.stringify(value)
}

function assertExcludesSentinel(value: unknown): void {
  assert.ok(!serialized(value).includes(sentinel))
}

describe('Sentry telemetry sanitization', () => {
  it('removes sensitive event content while retaining safe correlation metadata', () => {
    const event = sanitizeSentryEvent({
      type: undefined,
      event_id: 'a'.repeat(64),
      message: `provider failed with ${sentinel}`,
      logentry: { message: sentinel, params: [sentinel] },
      logger: sentinel,
      server_name: sentinel,
      fingerprint: [sentinel],
      modules: { [sentinel]: sentinel },
      measurements: { [sentinel]: { value: 1, unit: 'none' } },
      debug_meta: {
        images: [
          { type: 'sourcemap', code_file: sentinel, debug_id: sentinel },
        ],
      },
      threads: { values: [{ id: 1, name: sentinel }] },
      sdkProcessingMetadata: { source: sentinel },
      user: { email: `person+${sentinel}@example.com` },
      extra: { prompt: sentinel },
      tags: {
        traceId: telemetryTraceId,
        workflowRunId: recordId,
        authorization: bearer,
        arbitrary: sentinel,
      },
      request: {
        method: 'POST',
        url: `https://patchplane.example/api/callback?code=${sentinel}#fragment`,
        headers: { authorization: bearer, cookie: `session=${sentinel}` },
        data: { webhookBody: sentinel },
      },
      contexts: {
        trace: {
          trace_id: 'safe-trace',
          span_id: 'safe-span',
          secret: sentinel,
        },
        patchplane: {
          traceId: telemetryTraceId,
          operation: 'githubWorker.webhook',
          prompt: sentinel,
        },
        'patchplane.error': { message: sentinel },
        custom: { providerResponseBody: sentinel },
      },
      exception: {
        values: [
          {
            type: 'GitHubProviderError',
            value: `upstream response ${sentinel}`,
            mechanism: {
              type: 'generic',
              handled: true,
              data: { providerResponseBody: sentinel },
            },
            stacktrace: {
              frames: [
                {
                  filename: `https://example.com/app.js?token=${sentinel}`,
                  context_line: sentinel,
                  pre_context: [sentinel],
                  post_context: [sentinel],
                  vars: { token: sentinel },
                  instruction_addr: 'super-secret-value',
                  debug_id: 'super-secret-value',
                },
              ],
            },
          },
        ],
      },
      breadcrumbs: [
        {
          category: 'fetch',
          message: `https://example.com/path?token=${sentinel}`,
          data: {
            url: `https://example.com/path?token=${sentinel}`,
            authorization: bearer,
          },
        },
      ],
    })

    assertExcludesSentinel(event)
    assert.equal(event.event_id, undefined)
    assert.deepStrictEqual(event.tags, {
      traceId: telemetryTraceId,
      workflowRunId: recordId,
    })
    assert.deepStrictEqual(event.request, {
      method: 'POST',
      url: 'https://patchplane.example/:path',
    })
    const exception = event.exception?.values?.at(0)
    assert.equal(exception?.type, 'Error')
    assert.equal(exception?.value, 'Captured PatchPlane operation failure')
    assert.deepStrictEqual(exception?.mechanism, {
      type: 'generic',
      handled: true,
    })
    const frame = exception?.stacktrace?.frames?.at(0) ?? {}
    assert.ok(!('context_line' in frame))
    assert.ok(!('instruction_addr' in frame))
    assert.ok(!('debug_id' in frame))
  })

  it('rejects sensitive values even when supplied under allowlisted fields', () => {
    const event = sanitizeSentryEvent({
      type: undefined,
      tags: {
        traceId: sentinel,
        workflowRunId: sentinel,
        operation: sentinel,
        provider: sentinel,
        status: sentinel,
        release: sentinel,
        environment: sentinel,
      },
      contexts: {
        patchplane: {
          traceId: sentinel,
          operation: sentinel,
          provider: sentinel,
        },
      },
    })

    assert.deepStrictEqual(event.tags, {
      operation: 'patchplane.operation',
      status: 'patchplane.status',
    })
    assert.deepStrictEqual(event.contexts?.patchplane, {
      operation: 'patchplane.operation',
    })
    assertExcludesSentinel(event)
  })

  it('sanitizes transaction fields and retains the crash-proximate stack frames', () => {
    const frames = EffectArray.makeBy(70, (index) => ({
      function: sentinel,
      module: `customer${index}`,
      filename: `src/private/${sentinel}/${index}.js`,
      context_line: sentinel,
      lineno: index,
    }))
    const event = sanitizeSentryTransaction({
      type: 'transaction',
      transaction: `GET /workflows/run-1?prompt=${sentinel}`,
      spans: [
        {
          description: `run command ${sentinel}`,
          span_id: sentrySpanId,
          trace_id: sentryTraceId,
          start_timestamp: 1,
          data: { command: sentinel, operation: sentinel },
        },
      ],
      exception: { values: [{ type: 'Error', stacktrace: { frames } }] },
    })

    assert.equal(event.transaction, 'GET /:path')
    assert.equal(
      sanitizeSentryTransaction({
        type: 'transaction',
        transaction: sentinel,
      }).transaction,
      'patchplane.operation',
    )
    assert.equal(event.spans?.at(0)?.description, 'patchplane.operation')
    const retainedFrames = event.exception?.values?.at(0)?.stacktrace?.frames
    assert.equal(retainedFrames?.length, 64)
    assert.equal(retainedFrames?.at(0)?.function, 'patchplane.frame')
    assert.equal(retainedFrames?.at(0)?.module, 'patchplane.module')
    assert.equal(retainedFrames?.at(0)?.filename, '/:path')
    assert.equal(retainedFrames?.at(0)?.lineno, 6)
    assert.equal(retainedFrames?.at(-1)?.lineno, 69)
    assertExcludesSentinel(event)
  })

  it('keeps bounded PatchPlane breadcrumbs and filters automatic breadcrumb messages', () => {
    const patchplane = sanitizeSentryBreadcrumb({
      category: 'patchplane.workflow',
      message: 'candidate.frozen',
      data: {
        workflowRunId: recordId,
        candidatePatchSetId: recordId,
        prompt: sentinel,
      },
    })
    const automatic = sanitizeSentryBreadcrumb({
      category: sentinel,
      message: `developer printed ${sentinel}`,
      data: { output: sentinel },
    })

    assert.deepStrictEqual(patchplane, {
      category: 'patchplane.event',
      message: 'patchplane.event',
      data: { workflowRunId: recordId, candidatePatchSetId: recordId },
    })
    assert.deepStrictEqual(automatic, {
      category: 'sentry.automatic',
      message: '[Filtered]',
      data: {},
    })
    assertExcludesSentinel([patchplane, automatic])
  })

  it('drops unmarked logs and allowlists marked operational log attributes', () => {
    assert.equal(
      sanitizeSentryLog({
        level: 'info',
        message: 'untrusted',
        attributes: { prompt: sentinel },
      }),
      null,
    )

    const log = sanitizeSentryLog({
      level: 'error',
      message: `rerun instruction ${sentinel}`,
      attributes: {
        telemetryPolicy: sentryTelemetryPolicyMarker,
        operation: 'githubWorker.webhook',
        workflowRunId: recordId,
        providerResponseBody: sentinel,
      },
    })

    assert.deepStrictEqual(log, {
      level: 'error',
      message: 'patchplane.operational-event',
      attributes: {
        telemetryPolicy: sentryTelemetryPolicyMarker,
        operation: 'patchplane.operation',
        workflowRunId: recordId,
      },
    })
    assertExcludesSentinel(log)
  })

  it('sanitizes Effect metrics and allowlists metric attributes', () => {
    assert.equal(
      sanitizeSentryMetric({
        name: `secret metric ${sentinel}`,
        type: 'counter',
        value: 1,
        attributes: { prompt: sentinel },
      }),
      null,
    )

    const metric = sanitizeSentryMetric({
      name: 'patchplane.operation.count',
      type: 'counter',
      value: 1,
      attributes: {
        telemetryPolicy: sentryTelemetryPolicyMarker,
        operation: 'workflow.execute',
        command: sentinel,
      },
    })

    assert.deepStrictEqual(metric, {
      name: 'patchplane.operation.count',
      type: 'counter',
      value: 1,
      attributes: {
        telemetryPolicy: sentryTelemetryPolicyMarker,
        operation: 'patchplane.operation',
      },
    })
    assertExcludesSentinel(metric)
  })

  it('allowlists span attributes and strips URL query strings and fragments', () => {
    const span = sanitizeSentrySpan({
      description: `https://example.com/repository?token=${sentinel}#fragment`,
      span_id: sentrySpanId,
      trace_id: sentryTraceId,
      start_timestamp: 1,
      data: {
        traceId: telemetryTraceId,
        durationMs: 42,
        command: sentinel,
      },
    })

    assert.deepStrictEqual(span, {
      description: 'https://example.com/:path',
      span_id: sentrySpanId,
      trace_id: sentryTraceId,
      start_timestamp: 1,
      data: { traceId: telemetryTraceId, durationMs: 42 },
    })
    assertExcludesSentinel(span)
    assert.equal(
      sanitizeSentrySpan({
        description: sentinel,
        span_id: sentrySpanId,
        trace_id: sentryTraceId,
        start_timestamp: 1,
        data: {},
      }).description,
      'patchplane.operation',
    )
  })

  it('removes Sentry attachments before the event reaches transport', () => {
    const hint = {
      attachments: [
        {
          filename: 'evidence.txt',
          data: sentinel,
          contentType: 'text/plain',
        },
      ],
    }

    sanitizeSentryEvent({ type: undefined }, hint)

    assert.deepStrictEqual(hint.attachments, [])
    assertExcludesSentinel(hint)

    const blockedHint = new Proxy(
      { attachments: [{ filename: 'evidence.txt', data: sentinel }] },
      {
        set: () => {
          throw new Error(sentinel)
        },
      },
    )
    assert.equal(sanitizeSentryEvent({ type: undefined }, blockedHint), null)
  })

  it('fails closed when Sentry supplies throwing or malformed payloads', () => {
    const throwing = () => {
      throw new Error(sentinel)
    }
    const errorEvent = new Proxy<ErrorEvent>(
      { type: undefined },
      { get: throwing },
    )
    const breadcrumb = new Proxy<Breadcrumb>({}, { get: throwing })
    const log = new Proxy<Log>(
      { level: 'error', message: 'patchplane.event' },
      { get: throwing },
    )
    const metric = new Proxy<Metric>(
      { name: 'patchplane.metric', value: 1, type: 'counter' },
      { get: throwing },
    )
    const span = new Proxy<SpanJSON>(
      {
        span_id: sentrySpanId,
        trace_id: sentryTraceId,
        start_timestamp: 1,
        data: {},
      },
      { get: throwing },
    )

    assert.deepStrictEqual(sanitizeSentryEvent(errorEvent), {
      type: undefined,
      message: 'Captured PatchPlane operation event',
      tags: {},
    })
    assert.deepStrictEqual(sanitizeSentryBreadcrumb(breadcrumb), {
      category: 'sentry.automatic',
      message: '[Filtered]',
      data: {},
    })
    assert.equal(sanitizeSentryLog(log), null)
    assert.equal(sanitizeSentryMetric(metric), null)
    assert.deepStrictEqual(sanitizeSentrySpan(span), {
      span_id: '0000000000000000',
      trace_id: '00000000000000000000000000000000',
      start_timestamp: 0,
      description: 'patchplane.operation',
      data: {},
    })
    const mutableFallback = sanitizeSentryEvent(errorEvent)
    if (mutableFallback.tags !== undefined)
      mutableFallback.tags.traceId = 'mutated'
    assert.deepStrictEqual(sanitizeSentryEvent(errorEvent).tags, {})
    assertExcludesSentinel([
      sanitizeSentryEvent(errorEvent),
      sanitizeSentryBreadcrumb(breadcrumb),
      sanitizeSentryMetric(metric),
      sanitizeSentrySpan(span),
    ])
  })

  it('bounds URLs and removes query, fragment, and credential-like path content', () => {
    assert.equal(
      sanitizeTelemetryUrl(`/app/workflows/run-1?code=${sentinel}#fragment`),
      '/:path',
    )
    assert.equal(
      sanitizeTelemetryUrl(`https://example.com/path?code=${sentinel}`),
      'https://example.com/:path',
    )
    assert.equal(
      sanitizeTelemetryUrl(`https://example.com/${sentinel}/artifact`),
      'https://example.com/:path',
    )
    assert.equal(sanitizeTelemetryUrl('src/private/customer-name.ts'), '/:path')
    assert.equal(
      sanitizeTelemetryUrl('C:\\Users\\private\\customer-name.ts'),
      '/:path',
    )
    assert.equal(sanitizeTelemetryUrl(`http://[invalid/${sentinel}`), '/:path')
    assert.ok(
      sanitizeTelemetryUrl(`https://example.com/${'a'.repeat(1_000)}`).length <=
        513,
    )
  })
})
