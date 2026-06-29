import { Effect, Exit, Schema } from 'effect'
import type { SandboxRuntimeEvent } from '@patchplane/core/services/sandbox-service'

const PiEventHeader = Schema.Struct({
  type: Schema.String,
})

export interface PiRuntimeParseError {
  readonly line: number
  readonly message: string
  readonly raw: string
}

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function textFromMessageContent(content: unknown) {
  if (!Array.isArray(content)) {
    return undefined
  }

  const text = compactWhitespace(
    content.map((part) => {
      if (typeof part !== 'object' || part === null) return ''
      const value = Reflect.get(part, 'text')
      return typeof value === 'string' ? value : ''
    }).join(''),
  )

  return text.length === 0 ? undefined : text
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
  switch (type) {
    case 'session': {
      const id = Reflect.get(event, 'id')
      return typeof id === 'string' && id.length > 0 ? `Pi session ${id}` : 'Pi session started'
    }
    case 'agent_start':
      return 'Pi agent started'
    case 'agent_end':
      return 'Pi agent finished'
    case 'turn_start':
      return 'Pi turn started'
    case 'turn_end':
      return 'Pi turn finished'
    case 'tool_execution_start': {
      const toolName = Reflect.get(event, 'toolName')
      return `Pi tool started: ${typeof toolName === 'string' ? toolName : 'unknown'}`
    }
    case 'tool_execution_end': {
      const toolName = Reflect.get(event, 'toolName')
      return `Pi tool finished: ${typeof toolName === 'string' ? toolName : 'unknown'}`
    }
    case 'message_end': {
      const message = Reflect.get(event, 'message')
      const content = typeof message === 'object' && message !== null ? Reflect.get(message, 'content') : undefined
      const text = textFromMessageContent(content)
      return text === undefined ? 'Pi message finished' : `Pi message: ${text.slice(0, 160)}`
    }
    default:
      return `Pi event: ${type}`
  }
}

function parsePiJsonRuntimeEventLine(input: {
  readonly line: string
  readonly lineNumber: number
  readonly now: () => number
}): Effect.Effect<SandboxRuntimeEvent, PiRuntimeParseError> {
  return Effect.gen(function* () {
    const event = yield* Effect.try({
      try: () => JSON.parse(input.line) as unknown,
      catch: (error): PiRuntimeParseError => ({
        line: input.lineNumber,
        message: error instanceof Error ? error.message : String(error),
        raw: input.line.slice(0, 500),
      }),
    })
    const header = yield* Schema.decodeUnknownEffect(PiEventHeader)(event).pipe(
      Effect.mapError((error): PiRuntimeParseError => ({
        line: input.lineNumber,
        message: String(error),
        raw: input.line.slice(0, 500),
      })),
    )

    return {
      provider: 'pi',
      type: `pi.${header.type}`,
      occurredAt: piEventTimestamp(event, input.now()),
      summary: summarizePiEvent(event),
      payloadJson: JSON.stringify(event),
    } satisfies SandboxRuntimeEvent
  })
}

export function parsePiJsonRuntimeEventsEffect(stdout: string, options: {
  readonly now?: () => number
} = {}): Effect.Effect<{
  readonly events: ReadonlyArray<SandboxRuntimeEvent>
  readonly parseErrors: ReadonlyArray<PiRuntimeParseError>
}> {
  const now = options.now ?? Date.now
  return Effect.gen(function* () {
    const events: SandboxRuntimeEvent[] = []
    const parseErrors: PiRuntimeParseError[] = []

    for (const [index, rawLine] of stdout.split(/\r?\n/).entries()) {
      const line = rawLine.trim()
      if (line.length === 0) continue

      const result = yield* parsePiJsonRuntimeEventLine({
        line,
        lineNumber: index + 1,
        now,
      }).pipe(Effect.exit)

      if (Exit.isSuccess(result)) {
        events.push(result.value)
      } else {
        parseErrors.push({
          line: index + 1,
          message: 'Failed to parse Pi JSON event line',
          raw: line.slice(0, 500),
        })
      }
    }

    return { events, parseErrors } as const
  })
}
