import type {
  Contexts,
  ErrorEvent,
  Event,
  EventHint,
  TransactionEvent,
} from '@sentry/core'
import {
  MAX_COLLECTION_ENTRIES,
  decodeSentryEventId,
  decodeSentryExceptionType,
  decodeSentryLevel,
  decodeSentrySpanId,
  decodeSentryTraceId,
  decodeTelemetryEnvironment,
  decodeTelemetryMethod,
  discardSentryAttachments,
  makeSafeErrorEvent,
  makeSafeTransactionEvent,
} from './policy'
import {
  safeFiniteNumber,
  safeRelease,
  safeTelemetryName,
  sanitizeSentryAttributes,
  sanitizeTelemetryUrl,
} from './attributes'
import { sanitizeSentryBreadcrumb } from './breadcrumbs'
import { sanitizeSpanDescription, sanitizeStacktrace } from './exceptions'
import { sanitizeSentrySpan } from './signals'
import {
  Array as EffectArray,
  Option,
  Predicate,
  String as EffectString,
  pipe,
} from 'effect'

function sanitizeContexts(event: Event): Contexts | undefined {
  const trace = event.contexts?.trace
  const traceId = Option.getOrUndefined(decodeSentryTraceId(trace?.trace_id))
  const spanId = Option.getOrUndefined(decodeSentrySpanId(trace?.span_id))
  const parentSpanId = Option.getOrUndefined(
    decodeSentrySpanId(trace?.parent_span_id),
  )
  const safeTrace =
    traceId === undefined || spanId === undefined
      ? undefined
      : {
          trace_id: traceId,
          span_id: spanId,
          ...(parentSpanId === undefined
            ? {}
            : { parent_span_id: parentSpanId }),
          ...(safeTelemetryName(trace?.op) === undefined
            ? {}
            : { op: 'patchplane.operation' }),
          ...(safeTelemetryName(trace?.status) === undefined
            ? {}
            : { status: 'unknown' }),
        }
  const patchplane = Predicate.isObject(event.contexts?.patchplane)
    ? sanitizeSentryAttributes(event.contexts.patchplane)
    : undefined
  const hasErrorContext = Predicate.isObject(
    event.contexts?.['patchplane.error'],
  )

  if (safeTrace === undefined && patchplane === undefined && !hasErrorContext)
    return undefined
  return {
    ...(safeTrace === undefined ? {} : { trace: safeTrace }),
    ...(patchplane === undefined ? {} : { patchplane }),
    ...(hasErrorContext
      ? {
          'patchplane.error': {
            message: 'Captured PatchPlane operation failure',
          },
        }
      : {}),
  }
}

function sanitizeEvent(event: Event): Event {
  const requestMethod =
    typeof event.request?.method === 'string'
      ? Option.getOrUndefined(
          decodeTelemetryMethod(EffectString.toUpperCase(event.request.method)),
        )
      : undefined
  const request =
    event.request === undefined
      ? undefined
      : {
          ...(requestMethod === undefined ? {} : { method: requestMethod }),
          ...(typeof event.request.url === 'string'
            ? { url: sanitizeTelemetryUrl(event.request.url) }
            : {}),
        }
  const exception = EffectArray.isArray(event.exception?.values)
    ? {
        values: pipe(
          event.exception.values,
          EffectArray.take(MAX_COLLECTION_ENTRIES),
          EffectArray.map((entry) => {
            const exceptionType = Option.getOrUndefined(
              decodeSentryExceptionType(entry.type),
            )
            const mechanismType = safeTelemetryName(entry.mechanism?.type)
            const threadId =
              typeof entry.thread_id === 'number' ? entry.thread_id : undefined
            const mechanism =
              entry.mechanism === undefined || mechanismType === undefined
                ? undefined
                : {
                    type: 'generic',
                    ...(typeof entry.mechanism.handled === 'boolean'
                      ? { handled: entry.mechanism.handled }
                      : {}),
                    ...(typeof entry.mechanism.synthetic === 'boolean'
                      ? { synthetic: entry.mechanism.synthetic }
                      : {}),
                  }
            return {
              type: exceptionType ?? 'Error',
              value: 'Captured PatchPlane operation failure',
              ...(threadId === undefined ? {} : { thread_id: threadId }),
              ...(mechanism === undefined ? {} : { mechanism }),
              ...(entry.stacktrace === undefined
                ? {}
                : { stacktrace: sanitizeStacktrace(entry.stacktrace) }),
            }
          }),
        ),
      }
    : undefined
  const breadcrumbs = !EffectArray.isArray(event.breadcrumbs)
    ? undefined
    : pipe(
        event.breadcrumbs,
        EffectArray.takeRight(MAX_COLLECTION_ENTRIES),
        EffectArray.map(sanitizeSentryBreadcrumb),
      )
  const spans = !EffectArray.isArray(event.spans)
    ? undefined
    : pipe(
        event.spans,
        EffectArray.take(MAX_COLLECTION_ENTRIES),
        EffectArray.map(sanitizeSentrySpan),
      )
  const eventId = Option.getOrUndefined(decodeSentryEventId(event.event_id))
  const release = safeRelease(event.release)
  const environment = Option.getOrUndefined(
    decodeTelemetryEnvironment(event.environment),
  )
  const platform = safeTelemetryName(event.platform)
  const timestamp = safeFiniteNumber(event.timestamp)
  const startTimestamp = safeFiniteNumber(event.start_timestamp)
  const level = Option.getOrUndefined(decodeSentryLevel(event.level))
  const contexts = sanitizeContexts(event)

  return {
    type: event.type,
    ...(eventId === undefined ? {} : { event_id: eventId }),
    ...(timestamp === undefined ? {} : { timestamp }),
    ...(startTimestamp === undefined
      ? {}
      : { start_timestamp: startTimestamp }),
    ...(level === undefined ? {} : { level }),
    ...(platform === undefined ? {} : { platform: 'javascript' }),
    ...(release === undefined ? {} : { release }),
    ...(environment === undefined ? {} : { environment }),
    ...(request === undefined ? {} : { request }),
    ...(typeof event.transaction === 'string'
      ? { transaction: sanitizeSpanDescription(event.transaction) }
      : {}),
    ...(exception === undefined ? {} : { exception }),
    ...(breadcrumbs === undefined ? {} : { breadcrumbs }),
    ...(contexts === undefined ? {} : { contexts }),
    tags: sanitizeSentryAttributes(event.tags),
    ...(spans === undefined ? {} : { spans }),
    ...(event.message === undefined
      ? {}
      : { message: 'Captured PatchPlane operation event' }),
  }
}

const trySanitizeErrorEvent = Option.liftThrowable(
  (event: ErrorEvent): ErrorEvent => ({
    ...sanitizeEvent(event),
    type: undefined,
  }),
)
const trySanitizeTransaction = Option.liftThrowable(
  (event: TransactionEvent): TransactionEvent => ({
    ...sanitizeEvent(event),
    type: 'transaction',
  }),
)

export function sanitizeSentryEvent(event: ErrorEvent): ErrorEvent
export function sanitizeSentryEvent(
  event: ErrorEvent,
  hint: EventHint,
): ErrorEvent | null
export function sanitizeSentryEvent(
  event: ErrorEvent,
  hint?: EventHint,
): ErrorEvent | null {
  if (hint !== undefined && Option.isNone(discardSentryAttachments(hint)))
    return null
  return Option.getOrElse(trySanitizeErrorEvent(event), makeSafeErrorEvent)
}

export function sanitizeSentryTransaction(
  event: TransactionEvent,
): TransactionEvent
export function sanitizeSentryTransaction(
  event: TransactionEvent,
  hint: EventHint,
): TransactionEvent | null
export function sanitizeSentryTransaction(
  event: TransactionEvent,
  hint?: EventHint,
): TransactionEvent | null {
  if (hint !== undefined && Option.isNone(discardSentryAttachments(hint)))
    return null
  return Option.getOrElse(
    trySanitizeTransaction(event),
    makeSafeTransactionEvent,
  )
}
