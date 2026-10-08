import type { Stacktrace } from '@sentry/core'
import {
  MAX_COLLECTION_ENTRIES,
  MAX_STACK_INPUT_LENGTH,
  decodeDebugId,
  decodeInstructionAddress,
  decodeSentryExceptionType,
  decodeStackColumnNumber,
  decodeStackLineNumber,
  decodeTelemetryMethod,
  httpDescriptionPattern,
  stackLocationPattern,
} from './policy'
import {
  safeFiniteNumber,
  safeTelemetryName,
  sanitizeTelemetryUrl,
} from './attributes'
import {
  Array as EffectArray,
  Option,
  Predicate,
  String as EffectString,
  pipe,
} from 'effect'

export function sanitizeSentryException(error: unknown): Error {
  const safe = new Error('Captured PatchPlane operation failure')
  safe.name = 'Error'
  safe.stack = 'Error: Captured PatchPlane operation failure'

  const safeError = Option.liftThrowable(() =>
    error instanceof Error ? error : undefined,
  )()
  if (Option.isNone(safeError)) return safe
  const safeErrorValue = safeError.value
  if (safeErrorValue === undefined) return safe

  const errorName = Option.liftThrowable(() => safeErrorValue.name)()
  safe.name = Option.getOrElse(
    Option.flatMap(errorName, decodeSentryExceptionType),
    () => 'Error' as const,
  )
  safe.stack = `${safe.name}: Captured PatchPlane operation failure`

  const stack = Option.liftThrowable(() => safeErrorValue.stack)()
  if (Option.isNone(stack) || typeof stack.value !== 'string') return safe

  const frames = EffectString.slice(
    0,
    MAX_STACK_INPUT_LENGTH,
  )(stack.value)
    .split('\n')
    .slice(1, MAX_COLLECTION_ENTRIES + 1)
    .flatMap((line) => {
      const match = EffectString.match(stackLocationPattern)(line)
      if (Option.isNone(match)) return []
      const lineNumber = decodeStackLineNumber(Number(match.value[1]))
      const columnNumber = decodeStackColumnNumber(Number(match.value[2]))
      return Option.isNone(lineNumber) || Option.isNone(columnNumber)
        ? []
        : [
            `    at patchplane.frame (/:path:${lineNumber.value}:${columnNumber.value})`,
          ]
    })

  safe.stack = [safe.stack, ...frames].join('\n')
  return safe
}

export function sanitizeStacktrace(value: Stacktrace): Stacktrace {
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

export function sanitizeSpanDescription(value: string): string {
  if (
    EffectString.includes('://')(value) ||
    EffectString.startsWith('/')(value)
  )
    return sanitizeTelemetryUrl(value)
  return safeHttpDescription(value) ?? 'patchplane.operation'
}
