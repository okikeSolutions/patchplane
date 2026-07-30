import {
  FILTERED,
  MAX_STRING_LENGTH,
  type SafeAttribute,
  allowedAttributeNames,
  credentialPattern,
  decodeCriticalPathBreadcrumbStatus,
  decodeCriticalPathStage,
  decodeFiniteNumber,
  decodeTelemetryArchitecture,
  decodeTelemetryEnvironment,
  decodeTelemetryMethod,
  decodeTelemetryName,
  decodeTelemetryPlatform,
  decodeTelemetryPluginName,
  decodeTelemetryProvider,
  decodeTelemetryRecordId,
  decodeTelemetryRelease,
  decodeTelemetryTraceId,
  idAttributeNames,
  nameAttributeNames,
  numberAttributeNames,
  parseTelemetryUrl,
  queryOrFragmentPattern,
  readTelemetryAttribute,
  sentryTelemetryPolicyMarker,
  urlAttributeNames,
} from './policy'
import {
  Array as EffectArray,
  HashSet,
  Option,
  Predicate,
  Record as EffectRecord,
  String as EffectString,
  pipe,
} from 'effect'

function redactAndBound(value: string): string {
  const redacted = EffectString.replace(credentialPattern, FILTERED)(value)
  return redacted.length <= MAX_STRING_LENGTH
    ? redacted
    : `${EffectString.slice(0, MAX_STRING_LENGTH)(redacted)}…`
}

function containsFilteredContent(value: string): boolean {
  return EffectString.includes(FILTERED)(redactAndBound(value))
}

export function safeTelemetryName(
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

export function safeRelease(value: unknown): string | undefined {
  if (typeof value === 'string' && containsFilteredContent(value))
    return undefined
  return Option.getOrUndefined(decodeTelemetryRelease(value))
}

export function safeFiniteNumber(value: unknown): number | undefined {
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
  if (key === 'criticalPathStage' || key === 'stage') {
    return Option.getOrUndefined(decodeCriticalPathStage(value))
  }
  if (key === 'status') {
    return Option.getOrUndefined(decodeCriticalPathBreadcrumbStatus(value))
  }
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

export function sanitizeSentryAttributes(
  value: unknown,
): Record<string, SafeAttribute> {
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
