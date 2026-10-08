import { describe, expect, it } from '@effect/vitest'
import { Effect, Stream } from 'effect'
import { decodePiRpcRuntimeEvents } from './ingestion'

function collect(chunks: ReadonlyArray<string>) {
  return Stream.fromIterable(chunks).pipe(
    decodePiRpcRuntimeEvents({
      sessionId: 'session-1',
      commandId: 'command-1',
      now: () => 42,
    }),
    Stream.runCollect,
    Effect.map((events) => Array.from(events)),
  )
}

describe('decodePiRpcRuntimeEvents', () => {
  it.effect(
    'frames RPC responses and Pi events incrementally with stable idempotency keys',
    () =>
      Effect.gen(function* () {
        const first = JSON.stringify({
          id: 'a',
          type: 'response',
          command: 'get_state',
          success: true,
        })
        const second = JSON.stringify({
          type: 'agent_start',
          timestamp: '2026-01-01T00:00:00.000Z',
        })

        const events = yield* collect([
          first.slice(0, 12),
          `${first.slice(12)}\n${second}\n`,
        ])

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
        expect(events[0]?.payloadJson).toBe(
          JSON.stringify({ command: 'get_state', success: true }),
        )
        expect(events[1]?.payloadJson).toBe(
          JSON.stringify({ type: 'agent_start' }),
        )
        expect(events[0]?.idempotencyKey).toMatch(
          /^session-1:command-1:stdout:1:/,
        )
        expect(events[1]?.idempotencyKey).toMatch(
          /^session-1:command-1:stdout:2:/,
        )
      }),
  )

  it.effect('drops transient token and tool progress updates', () =>
    Effect.gen(function* () {
      const events = yield* collect([
        `${JSON.stringify({ type: 'message_update', delta: 'partial' })}\n`,
        `${JSON.stringify({ type: 'tool_execution_update', partialResult: 'partial' })}\n`,
        `${JSON.stringify({ type: 'message_end', message: { content: [{ text: 'Done' }] } })}\n`,
      ])

      expect(events).toHaveLength(1)
      expect(events[0]?.type).toBe('pi.message_end')
      expect(events[0]?.sourceLine).toBe(3)
      expect(events[0]?.summary).toBe('Pi message finished')
      expect(events[0]?.payloadJson).toBe(
        JSON.stringify({ type: 'message_end' }),
      )
    }),
  )

  it.effect(
    'fails closed on malformed RPC JSON without retaining its content',
    () =>
      Effect.gen(function* () {
        const error = yield* collect(['{"secret":"credential"']).pipe(
          Effect.flip,
        )
        expect(error).toMatchObject({
          _tag: 'PiRpcIngestionError',
          message: 'Malformed Pi RPC JSON record',
        })
        expect(String(error)).not.toContain('credential')
      }),
  )

  it.effect('drops unknown provider event types and forged RPC commands', () =>
    Effect.gen(function* () {
      const events = yield* collect([
        `${JSON.stringify({ type: 'provider_secret', value: 'sensitive' })}\n`,
        `${JSON.stringify({
          type: 'response',
          command: 'credential-content',
          success: true,
        })}\n`,
      ])

      expect(events).toEqual([])
    }),
  )

  it.effect(
    'keeps distinct identities for redacted events with different source records',
    () =>
      Effect.gen(function* () {
        const first = yield* collect([
          `${JSON.stringify({ type: 'message_end', message: { content: 'first' } })}\n`,
        ])
        const second = yield* collect([
          `${JSON.stringify({ type: 'message_end', message: { content: 'second' } })}\n`,
        ])

        expect(first[0]?.payloadJson).toBe(second[0]?.payloadJson)
        expect(first[0]?.idempotencyKey).not.toBe(second[0]?.idempotencyKey)
      }),
  )

  it.effect('uses strict LF JSONL framing', () =>
    Effect.gen(function* () {
      const line = JSON.stringify({
        id: 'a',
        type: 'response',
        command: 'abort',
        success: true,
      })
      const events = yield* collect([`${line}\r`, '\n'])

      expect(events).toHaveLength(1)
      expect(events[0]?.type).toBe('pi.rpc.response.abort.success')
    }),
  )
})
