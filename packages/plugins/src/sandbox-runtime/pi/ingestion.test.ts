import { describe, expect, test } from 'vitest'
import { Effect, Stream } from 'effect'
import { decodePiRpcRuntimeEvents } from './ingestion'

function collect(chunks: ReadonlyArray<string>) {
  return Effect.runPromise(Stream.fromIterable(chunks).pipe(
    decodePiRpcRuntimeEvents({
      sessionId: 'session-1',
      commandId: 'command-1',
      now: () => 42,
    }),
    Stream.runCollect,
    Effect.map((events) => Array.from(events)),
  ))
}

describe('decodePiRpcRuntimeEvents', () => {
  test('frames RPC responses and Pi events incrementally with stable idempotency keys', async () => {
    const first = JSON.stringify({ id: 'a', type: 'response', command: 'get_state', success: true })
    const second = JSON.stringify({ type: 'agent_start', timestamp: '2026-01-01T00:00:00.000Z' })

    const events = await collect([first.slice(0, 12), `${first.slice(12)}\n${second}\n`])

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      type: 'pi.rpc.response.get_state.success',
      sourceLine: 1,
      sourceOffset: 0,
    })
    expect(events[1]).toMatchObject({
      type: 'pi.agent_start',
      sourceLine: 2,
      occurredAt: Date.parse('2026-01-01T00:00:00.000Z'),
    })
    expect(events[0]?.idempotencyKey).toMatch(/^session-1:command-1:stdout:1:/)
    expect(events[1]?.idempotencyKey).toMatch(/^session-1:command-1:stdout:2:/)
  })

  test('uses strict LF JSONL framing', async () => {
    const line = JSON.stringify({ id: 'a', type: 'response', command: 'abort', success: true })
    const events = await collect([`${line}\r`, '\n'])

    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('pi.rpc.response.abort.success')
  })
})
