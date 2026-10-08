import { Effect, Exit, Match, Schema } from 'effect'
import type { SandboxRuntimeEvent } from '@patchplane/core/services/sandbox-service'

const PiEventHeader = Schema.Struct({
  type: Schema.String,
})

const transientPiEventTypes: ReadonlySet<string> = new Set([
  'message_update',
  'tool_execution_update',
])

const persistedPiEventTypes: ReadonlySet<string> = new Set([
  'session',
  'agent_start',
  'agent_end',
  'turn_start',
  'turn_end',
  'message_start',
  'message_end',
  'tool_execution_start',
  'tool_execution_end',
  'queue_update',
  'auto_compaction_start',
  'auto_compaction_end',
])

export function isTransientPiEventType(type: string) {
  return transientPiEventTypes.has(type)
}

export function isPersistedPiEventType(type: string) {
  return persistedPiEventTypes.has(type)
}

interface PiRuntimeParseError {
  readonly line: number
  readonly message: string
  readonly raw: string
}

function piEventTimestamp(event: unknown, fallback: number) {
  if (typeof event !== 'object' || event === null) return fallback
  const timestamp = Reflect.get(event, 'timestamp')
  if (typeof timestamp !== 'string') return fallback
  const parsed = Date.parse(timestamp)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function summarizePiEvent(event: unknown) {
  if (typeof event !== 'object' || event === null) {
    return 'Pi event: unknown'
  }

  const eventType = Reflect.get(event, 'type')
  const type = typeof eventType === 'string' ? eventType : 'unknown'
  return Match.value(type).pipe(
    Match.when('session', () => 'Pi session started'),
    Match.when('agent_start', () => 'Pi agent started'),
    Match.when('agent_end', () => 'Pi agent finished'),
    Match.when('turn_start', () => 'Pi turn started'),
    Match.when('turn_end', () => 'Pi turn finished'),
    Match.when('tool_execution_start', () => 'Pi tool started'),
    Match.when('tool_execution_end', () => 'Pi tool finished'),
    Match.when('message_end', () => 'Pi message finished'),
    Match.orElse(() => 'Pi runtime event'),
  )
}

const parsePiJsonRuntimeEventLine = Effect.fnUntraced(function* (input: {
  readonly line: string
  readonly lineNumber: number
  readonly now: () => number
}) {
  const event = yield* Effect.try({
    try: () => JSON.parse(input.line) as unknown,
    catch: (): PiRuntimeParseError => ({
      line: input.lineNumber,
      message: 'Failed to parse Pi JSON event line',
      raw: '[redacted]',
    }),
  })
  const header = yield* Schema.decodeUnknownEffect(PiEventHeader)(event).pipe(
    Effect.mapError(
      (): PiRuntimeParseError => ({
        line: input.lineNumber,
        message: 'Pi JSON event did not match the trusted header schema',
        raw: '[redacted]',
      }),
    ),
  )

  if (
    isTransientPiEventType(header.type) ||
    !isPersistedPiEventType(header.type)
  ) {
    return undefined
  }

  return {
    provider: 'pi',
    type: `pi.${header.type}`,
    occurredAt: piEventTimestamp(event, input.now()),
    summary: summarizePiEvent(event),
    payloadJson: JSON.stringify({ type: header.type }),
  } satisfies SandboxRuntimeEvent
})

export const parsePiJsonRuntimeEventsEffect = Effect.fnUntraced(function* (
  stdout: string,
  options: {
    readonly now: () => number
  },
) {
  const now = options.now
  const events: SandboxRuntimeEvent[] = []
  const parseErrors: PiRuntimeParseError[] = []

  const lines = stdout.split(/\r?\n/)
  if (lines.at(-1) === '') lines.pop()
  const lineLimitExceeded = lines.length > 1_000
  for (const [index, rawLine] of lines.slice(0, 1_000).entries()) {
    const line = rawLine.trim()
    if (line.length === 0) continue

    const result = yield* parsePiJsonRuntimeEventLine({
      line,
      lineNumber: index + 1,
      now,
    }).pipe(Effect.exit)

    if (Exit.isSuccess(result)) {
      if (result.value !== undefined) events.push(result.value)
    } else {
      parseErrors.push({
        line: index + 1,
        message: 'Failed to parse Pi JSON event line',
        raw: '[redacted]',
      })
    }
  }

  return { events, parseErrors, lineLimitExceeded } as const
})
