import { Stream } from 'effect'
import type { SandboxRuntimeEvent } from '@patchplane/core/services/sandbox-service'
import { decodePiJsonlLines, type PiJsonlLine } from './jsonl'
import { parsePiRpcJsonLines, type PiRpcParsedLine } from './protocol'
import { summarizePiEvent } from './events'

export interface PiRpcRuntimeEvent extends SandboxRuntimeEvent {
  readonly idempotencyKey: string
  readonly sourceSessionId: string
  readonly sourceCommandId: string
  readonly sourceStream: 'stdout' | 'stderr'
  readonly sourceLine: number
  readonly sourceOffset: number
}

function stableHash(input: string) {
  let hash = 2166136261
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function eventTimestamp(event: unknown, fallback: number) {
  if (typeof event !== 'object' || event === null) return fallback
  const timestamp = Reflect.get(event, 'timestamp')
  if (typeof timestamp !== 'string') return fallback
  const parsed = Date.parse(timestamp)
  return Number.isFinite(parsed) ? parsed : fallback
}

function rpcRecordToRuntimeEvent(record: PiRpcParsedLine, line: string, now: () => number): SandboxRuntimeEvent | undefined {
  if (record.kind === 'response') {
    return {
      provider: 'pi',
      type: `pi.rpc.response.${record.value.command}.${record.value.success ? 'success' : 'failure'}`,
      occurredAt: now(),
      summary: record.value.success
        ? `Pi RPC ${record.value.command} accepted`
        : `Pi RPC ${record.value.command} failed`,
      payloadJson: JSON.stringify(record.value),
    }
  }

  if (typeof record.value !== 'object' || record.value === null) return undefined
  const eventType = Reflect.get(record.value, 'type')
  if (typeof eventType !== 'string') return undefined

  return {
    provider: 'pi',
    type: `pi.${eventType}`,
    occurredAt: eventTimestamp(record.value, now()),
    summary: summarizePiEvent(record.value),
    payloadJson: line,
  }
}

function lineToRuntimeEvents(input: {
  readonly sessionId: string
  readonly commandId: string
  readonly stream: 'stdout' | 'stderr'
  readonly now: () => number
  readonly line: PiJsonlLine
}): ReadonlyArray<PiRpcRuntimeEvent> {
  if (input.line.line.length === 0) return []
  const parsed = parsePiRpcJsonLines(`${input.line.line}\n`)
  const events: PiRpcRuntimeEvent[] = []

  for (const record of parsed.records) {
    const runtimeEvent = rpcRecordToRuntimeEvent(record, input.line.line, input.now)
    if (runtimeEvent === undefined) continue
    events.push({
      ...runtimeEvent,
      idempotencyKey: `${input.sessionId}:${input.commandId}:${input.stream}:${input.line.lineNumber}:${stableHash(input.line.line)}`,
      sourceSessionId: input.sessionId,
      sourceCommandId: input.commandId,
      sourceStream: input.stream,
      sourceLine: input.line.lineNumber,
      sourceOffset: input.line.sourceOffset,
    })
  }

  return events
}

export function decodePiRpcRuntimeEvents(input: {
  readonly sessionId: string
  readonly commandId: string
  readonly stream?: 'stdout' | 'stderr' | undefined
  readonly now?: (() => number) | undefined
}) {
  const streamName = input.stream ?? 'stdout'
  const now = input.now ?? Date.now
  return <E, R>(chunks: Stream.Stream<string, E, R>): Stream.Stream<PiRpcRuntimeEvent, E, R> =>
    chunks.pipe(
      decodePiJsonlLines,
      Stream.mapAccumArray(
        () => undefined,
        (_, lines) => [undefined, lines.flatMap((line) => lineToRuntimeEvents({
          sessionId: input.sessionId,
          commandId: input.commandId,
          stream: streamName,
          now,
          line,
        }))],
      ),
    )
}
