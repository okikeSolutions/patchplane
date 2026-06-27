import type { SandboxRuntimeEvent } from '@patchplane/core/services/sandbox-service'

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

function piEventType(event: unknown) {
  if (typeof event !== 'object' || event === null) return 'unknown'
  const type = Reflect.get(event, 'type')
  return typeof type === 'string' && type.length > 0 ? type : 'unknown'
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

  const type = piEventType(event)
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

export function parsePiJsonRuntimeEvents(stdout: string, options: {
  readonly now?: () => number
} = {}): {
  readonly events: ReadonlyArray<SandboxRuntimeEvent>
  readonly parseErrors: ReadonlyArray<{ readonly line: number; readonly message: string; readonly raw: string }>
} {
  const now = options.now ?? Date.now
  const events: SandboxRuntimeEvent[] = []
  const parseErrors: Array<{ line: number; message: string; raw: string }> = []

  for (const [index, rawLine] of stdout.split(/\r?\n/).entries()) {
    const line = rawLine.trim()
    if (line.length === 0) continue

    try {
      const event: unknown = JSON.parse(line)
      const occurredAt = piEventTimestamp(event, now())
      const type = piEventType(event)
      events.push({
        provider: 'pi',
        type: `pi.${type}`,
        occurredAt,
        summary: summarizePiEvent(event),
        payloadJson: JSON.stringify(event),
      })
    } catch (error) {
      parseErrors.push({
        line: index + 1,
        message: error instanceof Error ? error.message : String(error),
        raw: line.slice(0, 500),
      })
    }
  }

  return { events, parseErrors }
}
