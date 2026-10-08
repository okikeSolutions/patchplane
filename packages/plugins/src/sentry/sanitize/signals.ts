import type { Log, Metric, SpanJSON, StreamedSpanJSON } from '@sentry/core'
import {
  decodeSentryLogLevel,
  decodeSentryMetricName,
  decodeSentryMetricType,
  decodeSentrySpanId,
  decodeSentryTraceId,
  makeSafeSpan,
  sentryTelemetryPolicyMarker,
} from './policy'
import {
  safeFiniteNumber,
  safeTelemetryName,
  sanitizeSentryAttributes,
} from './attributes'
import { sanitizeSpanDescription } from './exceptions'
import { Option, Predicate, Record as EffectRecord } from 'effect'

function sanitizeLog(log: Log): Log | null {
  if (!Predicate.isObject(log.attributes)) return null
  if (log.attributes.telemetryPolicy !== sentryTelemetryPolicyMarker)
    return null
  const level = Option.getOrUndefined(decodeSentryLogLevel(log.level))
  if (level === undefined) return null
  const severityNumber = safeFiniteNumber(log.severityNumber)
  return {
    level,
    message: 'patchplane.operational-event',
    ...(severityNumber === undefined ? {} : { severityNumber }),
    attributes: sanitizeSentryAttributes(log.attributes),
  }
}

const trySanitizeLog = Option.liftThrowable(sanitizeLog)

export function sanitizeSentryLog(log: Log): Log | null {
  return Option.getOrElse(trySanitizeLog(log), () => null)
}

function sanitizeMetric(metric: Metric): Metric | null {
  const name = Option.getOrUndefined(decodeSentryMetricName(metric.name))
  const value = safeFiniteNumber(metric.value)
  const type = Option.getOrUndefined(decodeSentryMetricType(metric.type))
  if (name === undefined || value === undefined || type === undefined)
    return null
  return {
    name,
    value,
    type,
    attributes: sanitizeSentryAttributes(metric.attributes),
  }
}

const trySanitizeMetric = Option.liftThrowable(sanitizeMetric)

export function sanitizeSentryMetric(metric: Metric): Metric | null {
  return Option.getOrElse(trySanitizeMetric(metric), () => null)
}

function sanitizeSpan(span: SpanJSON): SpanJSON {
  const operation = safeTelemetryName(span.op)
  const startTimestamp = safeFiniteNumber(span.start_timestamp) ?? 0
  const endTimestamp = safeFiniteNumber(span.timestamp)
  const exclusiveTime = safeFiniteNumber(span.exclusive_time)
  const spanId = Option.getOrElse(
    decodeSentrySpanId(span.span_id),
    () => '0000000000000000',
  )
  const traceId = Option.getOrElse(
    decodeSentryTraceId(span.trace_id),
    () => '00000000000000000000000000000000',
  )
  const parentSpanId = Option.getOrUndefined(
    decodeSentrySpanId(span.parent_span_id),
  )
  const segmentId = Option.getOrUndefined(decodeSentrySpanId(span.segment_id))
  const data = EffectRecord.filter(
    sanitizeSentryAttributes(span.data),
    (value): value is string | number | boolean => value !== null,
  )
  return {
    span_id: spanId,
    trace_id: traceId,
    start_timestamp: startTimestamp,
    data,
    ...(typeof span.description === 'string'
      ? { description: sanitizeSpanDescription(span.description) }
      : {}),
    ...(operation === undefined ? {} : { op: 'patchplane.operation' }),
    ...(parentSpanId === undefined ? {} : { parent_span_id: parentSpanId }),
    status: 'unknown',
    ...(endTimestamp === undefined ? {} : { timestamp: endTimestamp }),
    ...(exclusiveTime === undefined ? {} : { exclusive_time: exclusiveTime }),
    ...(typeof span.is_segment === 'boolean'
      ? { is_segment: span.is_segment }
      : {}),
    ...(segmentId === undefined ? {} : { segment_id: segmentId }),
  }
}

const trySanitizeSpan = Option.liftThrowable(sanitizeSpan)

export function sanitizeSentrySpan(span: SpanJSON): SpanJSON {
  return Option.getOrElse(trySanitizeSpan(span), makeSafeSpan)
}

function makeSafeStreamedSpan(): StreamedSpanJSON {
  return {
    trace_id: '00000000000000000000000000000000',
    span_id: '0000000000000000',
    name: 'patchplane.operation',
    start_timestamp: 0,
    status: 'error',
    is_segment: false,
    attributes: {},
  }
}

function sanitizeStreamedSpan(span: StreamedSpanJSON): StreamedSpanJSON {
  const startTimestamp = safeFiniteNumber(span.start_timestamp) ?? 0
  const endTimestamp = safeFiniteNumber(span.end_timestamp)
  const spanId = Option.getOrElse(
    decodeSentrySpanId(span.span_id),
    () => '0000000000000000',
  )
  const traceId = Option.getOrElse(
    decodeSentryTraceId(span.trace_id),
    () => '00000000000000000000000000000000',
  )
  const parentSpanId = Option.getOrUndefined(
    decodeSentrySpanId(span.parent_span_id),
  )

  return {
    trace_id: traceId,
    span_id: spanId,
    name: sanitizeSpanDescription(span.name),
    start_timestamp: startTimestamp,
    ...(endTimestamp === undefined ? {} : { end_timestamp: endTimestamp }),
    status: span.status === 'ok' ? 'ok' : 'error',
    is_segment: span.is_segment,
    attributes: sanitizeSentryAttributes(span.attributes),
    ...(parentSpanId === undefined ? {} : { parent_span_id: parentSpanId }),
  }
}

const trySanitizeStreamedSpan = Option.liftThrowable(sanitizeStreamedSpan)

export function sanitizeSentryStreamedSpan(
  span: StreamedSpanJSON,
): StreamedSpanJSON {
  return Option.getOrElse(trySanitizeStreamedSpan(span), makeSafeStreamedSpan)
}

export function sanitizeSentrySpanName(value: string): string {
  return Option.getOrElse(
    Option.liftThrowable(() => sanitizeSpanDescription(value))(),
    () => 'patchplane.operation',
  )
}
