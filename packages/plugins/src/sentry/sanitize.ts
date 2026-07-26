import type {
  Breadcrumb,
  Contexts,
  ErrorEvent,
  Event,
  EventHint,
  Log,
  Metric,
  SpanJSON,
  Stacktrace,
  TransactionEvent,
} from '@sentry/core'
import {
  Array as EffectArray,
  HashSet,
  Option,
  Predicate,
  Record as EffectRecord,
  RegExp as EffectRegExp,
  Schema,
  String as EffectString,
  pipe,
} from 'effect'

const FILTERED = '[Filtered]'
const MAX_STRING_LENGTH = 512
const MAX_COLLECTION_ENTRIES = 64

const credentialPattern = new EffectRegExp.RegExp(
  String.raw`(?:bearer\s+[a-z0-9._~+/-]+=*|gh[pousr]_[a-z0-9_]{20,}|github_pat_[a-z0-9_]{20,}|(?:eyJ[a-z0-9_-]+\.){2}[a-z0-9_-]+|(?:api[_-]?key|password|secret|token)\s*[:=]\s*[^\s,;]+|(?:api[_-]?key|password|secret|token)_[a-z0-9_-]{12,})`,
  'gi',
)
const queryOrFragmentPattern = new EffectRegExp.RegExp('[?#]')
const httpDescriptionPattern = new EffectRegExp.RegExp(
  '^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\\s+(.+)$',
  'i',
)
const TelemetryName = Schema.String.check(
  Schema.isMaxLength(160),
  Schema.isPattern(
    new EffectRegExp.RegExp('^[a-z][a-z0-9@]*(?:[._:/-][a-z0-9@]+)*$', 'i'),
  ),
).pipe(Schema.brand('SentryTelemetryName'))
const TelemetryTraceId = Schema.String.check(
  Schema.isPattern(
    new EffectRegExp.RegExp(
      '^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$',
      'i',
    ),
  ),
).pipe(Schema.brand('SentryTelemetryTraceId'))
const TelemetryRecordId = Schema.String.check(
  Schema.isPattern(new EffectRegExp.RegExp('^[a-z][a-z0-9]{31}$')),
).pipe(Schema.brand('SentryTelemetryRecordId'))
const TelemetryRelease = Schema.String.check(
  Schema.isMaxLength(128),
  Schema.isPattern(
    new EffectRegExp.RegExp(
      '^(?:[0-9a-f]{7,64}|v?\\d+\\.\\d+\\.\\d+(?:[-+][a-z0-9.-]+)?)$',
      'i',
    ),
  ),
).pipe(Schema.brand('SentryTelemetryRelease'))
const SentryEventId = Schema.String.check(
  Schema.isPattern(new EffectRegExp.RegExp('^[0-9a-f]{32}$', 'i')),
)
const SentryTraceId = Schema.String.check(
  Schema.isPattern(new EffectRegExp.RegExp('^[0-9a-f]{32}$', 'i')),
)
const SentrySpanId = Schema.String.check(
  Schema.isPattern(new EffectRegExp.RegExp('^[0-9a-f]{16}$', 'i')),
)
const TelemetryMethod = Schema.Literals([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
])
const TelemetryPlatform = Schema.Literals([
  'browser',
  'cloudflare',
  'linux',
  'macos',
  'windows',
  'unknown',
])
const TelemetryArchitecture = Schema.Literals([
  'arm64',
  'x64',
  'x86_64',
  'unknown',
])
const TelemetryPluginName = Schema.Literals([
  'artifacts',
  'cloudflare-r2-artifacts',
  'convex',
  'daytona',
  'github',
  'sentry',
  'workos',
])
const TelemetryProvider = Schema.Literals([
  'cloudflare',
  'convex',
  'daytona',
  'github',
  'openai',
  'anthropic',
  'google',
  'workos',
])
const TelemetryEnvironment = Schema.Literals([
  'development',
  'preview',
  'production',
  'staging',
  'test',
])
const SentryLevel = Schema.Literals([
  'fatal',
  'error',
  'warning',
  'log',
  'info',
  'debug',
])
const SentryMetricType = Schema.Literals(['counter', 'gauge', 'distribution'])
const SentryLogLevel = Schema.Literals([
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
])
const SentryMetricName = Schema.Literals([
  'patchplane.operation.count',
  'patchplane.operation.duration',
])
const decodeTelemetryName = Schema.decodeUnknownOption(TelemetryName)
const decodeTelemetryTraceId = Schema.decodeUnknownOption(TelemetryTraceId)
const decodeTelemetryRecordId = Schema.decodeUnknownOption(TelemetryRecordId)
const decodeTelemetryRelease = Schema.decodeUnknownOption(TelemetryRelease)
const decodeSentryEventId = Schema.decodeUnknownOption(SentryEventId)
const decodeSentryTraceId = Schema.decodeUnknownOption(SentryTraceId)
const decodeSentrySpanId = Schema.decodeUnknownOption(SentrySpanId)
const decodeTelemetryMethod = Schema.decodeUnknownOption(TelemetryMethod)
const decodeTelemetryPlatform = Schema.decodeUnknownOption(TelemetryPlatform)
const decodeTelemetryArchitecture = Schema.decodeUnknownOption(
  TelemetryArchitecture,
)
const decodeTelemetryPluginName =
  Schema.decodeUnknownOption(TelemetryPluginName)
const decodeTelemetryProvider = Schema.decodeUnknownOption(TelemetryProvider)
const decodeTelemetryEnvironment =
  Schema.decodeUnknownOption(TelemetryEnvironment)
const decodeSentryLevel = Schema.decodeUnknownOption(SentryLevel)
const decodeSentryMetricType = Schema.decodeUnknownOption(SentryMetricType)
const decodeSentryLogLevel = Schema.decodeUnknownOption(SentryLogLevel)
const decodeSentryMetricName = Schema.decodeUnknownOption(SentryMetricName)
const decodeFiniteNumber = Schema.decodeUnknownOption(Schema.Finite)
const decodeInstructionAddress = Schema.decodeUnknownOption(
  Schema.String.check(
    Schema.isPattern(new EffectRegExp.RegExp('^(?:0x)?[0-9a-f]{1,32}$', 'i')),
  ),
)
const decodeDebugId = Schema.decodeUnknownOption(
  Schema.String.check(
    Schema.isPattern(
      new EffectRegExp.RegExp(
        '^(?:[0-9a-f]{32}|[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$',
        'i',
      ),
    ),
  ),
)
const parseTelemetryUrl = Option.liftThrowable(
  (value: string) => new URL(value, 'https://patchplane.invalid'),
)

const idAttributeNames = HashSet.make(
  'workflowRunId',
  'rootWorkflowRunId',
  'runtimeSessionId',
  'sandboxExecutionId',
  'candidatePatchSetId',
  'verificationRequirementId',
  'reviewRunId',
  'policyDecisionId',
  'humanDecisionId',
  'publicationId',
)
const nameAttributeNames = HashSet.make(
  'publicationKind',
  'criticalPathStage',
  'stage',
  'status',
)
const numberAttributeNames = HashSet.make(
  'count',
  'durationMs',
  'status_code',
  'statusCode',
)
const urlAttributeNames = HashSet.make('url', 'from', 'to')
const allowedAttributeNames = [
  'traceId',
  'workflowRunId',
  'rootWorkflowRunId',
  'runtimeSessionId',
  'sandboxExecutionId',
  'candidatePatchSetId',
  'verificationRequirementId',
  'reviewRunId',
  'policyDecisionId',
  'humanDecisionId',
  'publicationId',
  'publicationKind',
  'pluginName',
  'operation',
  'criticalPathStage',
  'stage',
  'status',
  'provider',
  'errorCode',
  'errorCategory',
  'count',
  'durationMs',
  'status_code',
  'statusCode',
  'url',
  'from',
  'to',
  'method',
  'platform',
  'architecture',
  'environment',
  'release',
  'telemetryPolicy',
] as const
const readTelemetryAttribute = Option.liftThrowable(
  (record: { readonly [key: PropertyKey]: unknown }, key: string) =>
    record[key],
)
const discardSentryAttachments = Option.liftThrowable((hint: EventHint) => {
  hint.attachments = []
})

export const sentryTelemetryPolicyMarker = 'allowlisted-v1'

type SafeAttribute = string | number | boolean | null

function makeSafeErrorEvent(): ErrorEvent {
  return {
    type: undefined,
    message: 'Captured PatchPlane operation event',
    tags: {},
  }
}

function makeSafeTransactionEvent(): TransactionEvent {
  return {
    type: 'transaction',
    transaction: 'patchplane.operation',
    tags: {},
  }
}

function makeSafeBreadcrumb(): Breadcrumb {
  return {
    category: 'sentry.automatic',
    message: FILTERED,
    data: {},
  }
}

function makeSafeSpan(): SpanJSON {
  return {
    span_id: '0000000000000000',
    trace_id: '00000000000000000000000000000000',
    start_timestamp: 0,
    description: 'patchplane.operation',
    data: {},
  }
}

function redactAndBound(value: string): string {
  const redacted = EffectString.replace(credentialPattern, FILTERED)(value)
  return redacted.length <= MAX_STRING_LENGTH
    ? redacted
    : `${EffectString.slice(0, MAX_STRING_LENGTH)(redacted)}…`
}

function containsFilteredContent(value: string): boolean {
  return EffectString.includes(FILTERED)(redactAndBound(value))
}

function safeTelemetryName(
  value: unknown,
  fallback?: string,
): string | undefined {
  if (typeof value === 'string' && containsFilteredContent(value))
    return fallback
  return Option.getOrElse(decodeTelemetryName(value), () => fallback)
}

function safeRecordId(value: unknown): string | undefined {
  if (typeof value === 'string' && containsFilteredContent(value))
    return undefined
  return Option.getOrUndefined(decodeTelemetryRecordId(value))
}

function safeRelease(value: unknown): string | undefined {
  if (typeof value === 'string' && containsFilteredContent(value))
    return undefined
  return Option.getOrUndefined(decodeTelemetryRelease(value))
}

function safeFiniteNumber(value: unknown): number | undefined {
  return Option.getOrUndefined(decodeFiniteNumber(value))
}

export function sanitizeTelemetryUrl(value: string): string {
  const queryIndex = Option.getOrElse(
    EffectString.search(queryOrFragmentPattern)(value),
    () => value.length,
  )
  const withoutQuery = EffectString.slice(0, queryIndex)(value)
  if (EffectString.includes('\\')(withoutQuery)) return '/:path'

  return parseTelemetryUrl(withoutQuery).pipe(
    Option.map((url) => {
      const normalizedPath = url.pathname === '/' ? '/' : '/:path'
      return url.origin === 'https://patchplane.invalid'
        ? normalizedPath
        : `${url.origin}${normalizedPath}`
    }),
    Option.getOrElse(() => '/:path'),
    redactAndBound,
  )
}

function sanitizeAttribute(
  key: string,
  value: unknown,
): SafeAttribute | undefined {
  if (key === 'traceId') {
    return Option.getOrUndefined(decodeTelemetryTraceId(value))
  }
  if (HashSet.has(idAttributeNames, key)) return safeRecordId(value)
  if (HashSet.has(nameAttributeNames, key)) {
    return safeTelemetryName(value) === undefined
      ? undefined
      : `patchplane.${key}`
  }
  if (key === 'operation') {
    return safeTelemetryName(value) === undefined
      ? undefined
      : 'patchplane.operation'
  }
  if (key === 'errorCode' || key === 'errorCategory') {
    return safeTelemetryName(value) === undefined
      ? undefined
      : 'patchplane.error'
  }
  if (key === 'pluginName') {
    return Option.getOrUndefined(decodeTelemetryPluginName(value))
  }
  if (key === 'provider') {
    return Option.getOrUndefined(decodeTelemetryProvider(value))
  }
  if (HashSet.has(numberAttributeNames, key)) return safeFiniteNumber(value)
  if (HashSet.has(urlAttributeNames, key)) {
    return typeof value === 'string' ? sanitizeTelemetryUrl(value) : undefined
  }
  if (key === 'method') {
    return typeof value === 'string'
      ? Option.getOrUndefined(
          decodeTelemetryMethod(EffectString.toUpperCase(value)),
        )
      : undefined
  }
  if (key === 'platform') {
    return Option.getOrUndefined(decodeTelemetryPlatform(value))
  }
  if (key === 'architecture') {
    return Option.getOrUndefined(decodeTelemetryArchitecture(value))
  }
  if (key === 'environment') {
    return Option.getOrUndefined(decodeTelemetryEnvironment(value))
  }
  if (key === 'release') return safeRelease(value)
  if (key === 'telemetryPolicy') {
    return value === sentryTelemetryPolicyMarker
      ? sentryTelemetryPolicyMarker
      : undefined
  }
  return undefined
}

function sanitizeAttributes(value: unknown): Record<string, SafeAttribute> {
  if (!Predicate.isObject(value)) return {}
  return pipe(
    allowedAttributeNames,
    EffectArray.map((key) =>
      readTelemetryAttribute(value, key).pipe(
        Option.flatMap((entry) =>
          Option.fromUndefinedOr(sanitizeAttribute(key, entry)),
        ),
        Option.map((sanitized) => [key, sanitized] as const),
      ),
    ),
    EffectArray.getSomes,
    EffectRecord.fromEntries,
  )
}

function sanitizeStacktrace(value: Stacktrace): Stacktrace {
  if (!EffectArray.isArray(value.frames)) return {}
  return {
    frames: pipe(
      value.frames,
      EffectArray.takeRight(MAX_COLLECTION_ENTRIES),
      EffectArray.map((frame) => {
        if (!Predicate.isObject(frame)) return {}
        const functionName = safeTelemetryName(frame.function)
        const module = safeTelemetryName(frame.module)
        const platform = safeTelemetryName(frame.platform)
        const addressMode = safeTelemetryName(frame.addr_mode)
        const lineNumber = safeFiniteNumber(frame.lineno)
        const columnNumber = safeFiniteNumber(frame.colno)
        const instructionAddress = Option.getOrUndefined(
          decodeInstructionAddress(frame.instruction_addr),
        )
        const debugId = Option.getOrUndefined(decodeDebugId(frame.debug_id))
        return {
          ...(typeof frame.filename === 'string'
            ? { filename: sanitizeTelemetryUrl(frame.filename) }
            : {}),
          ...(typeof frame.abs_path === 'string'
            ? { abs_path: sanitizeTelemetryUrl(frame.abs_path) }
            : {}),
          ...(functionName === undefined
            ? {}
            : { function: 'patchplane.frame' }),
          ...(module === undefined ? {} : { module: 'patchplane.module' }),
          ...(platform === undefined ? {} : { platform: 'javascript' }),
          ...(lineNumber === undefined ? {} : { lineno: lineNumber }),
          ...(columnNumber === undefined ? {} : { colno: columnNumber }),
          ...(typeof frame.in_app === 'boolean'
            ? { in_app: frame.in_app }
            : {}),
          ...(instructionAddress === undefined
            ? {}
            : { instruction_addr: instructionAddress }),
          ...(addressMode === undefined ? {} : { addr_mode: 'unknown' }),
          ...(debugId === undefined ? {} : { debug_id: debugId }),
        }
      }),
    ),
  }
}

function safeHttpDescription(value: string): string | undefined {
  const match = EffectString.match(httpDescriptionPattern)(value)
  if (Option.isNone(match)) return undefined
  const method = match.value[1]
  const target = match.value[2]
  if (method === undefined || target === undefined) return undefined
  return decodeTelemetryMethod(EffectString.toUpperCase(method)).pipe(
    Option.map(
      (decodedMethod) => `${decodedMethod} ${sanitizeTelemetryUrl(target)}`,
    ),
    Option.getOrUndefined,
  )
}

function sanitizeSpanDescription(value: string): string {
  if (
    EffectString.includes('://')(value) ||
    EffectString.startsWith('/')(value)
  )
    return sanitizeTelemetryUrl(value)
  return safeHttpDescription(value) ?? 'patchplane.operation'
}

function sanitizeBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const requestedCategory = safeTelemetryName(breadcrumb.category)
  const patchplaneBreadcrumb =
    requestedCategory !== undefined &&
    EffectString.startsWith('patchplane.')(requestedCategory)
  const category = patchplaneBreadcrumb
    ? 'patchplane.event'
    : 'sentry.automatic'
  const level = Option.getOrUndefined(decodeSentryLevel(breadcrumb.level))
  const timestamp = safeFiniteNumber(breadcrumb.timestamp)
  const message =
    typeof breadcrumb.message === 'string'
      ? patchplaneBreadcrumb
        ? 'patchplane.event'
        : EffectString.includes('://')(breadcrumb.message) ||
            EffectString.startsWith('/')(breadcrumb.message)
          ? sanitizeTelemetryUrl(breadcrumb.message)
          : FILTERED
      : undefined

  return {
    ...(category === undefined ? {} : { category }),
    ...(level === undefined ? {} : { level }),
    ...(timestamp === undefined ? {} : { timestamp }),
    ...(message === undefined ? {} : { message }),
    data: sanitizeAttributes(breadcrumb.data),
  }
}

const trySanitizeBreadcrumb = Option.liftThrowable(sanitizeBreadcrumb)

export function sanitizeSentryBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  return Option.getOrElse(trySanitizeBreadcrumb(breadcrumb), makeSafeBreadcrumb)
}

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
    ? sanitizeAttributes(event.contexts.patchplane)
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
            const exceptionType = safeTelemetryName(entry.type)
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
              ...(exceptionType === undefined ? {} : { type: 'Error' }),
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
    tags: sanitizeAttributes(event.tags),
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
    attributes: sanitizeAttributes(log.attributes),
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
    attributes: sanitizeAttributes(metric.attributes),
  }
}

const trySanitizeMetric = Option.liftThrowable(sanitizeMetric)

export function sanitizeSentryMetric(metric: Metric): Metric | null {
  return Option.getOrElse(trySanitizeMetric(metric), () => null)
}

function sanitizeSpan(span: SpanJSON): SpanJSON {
  const operation = safeTelemetryName(span.op)
  const status = safeTelemetryName(span.status)
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
    sanitizeAttributes(span.data),
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
    ...(status === undefined ? {} : { status: 'unknown' }),
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
