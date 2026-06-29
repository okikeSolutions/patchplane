import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { parsePiRpcJsonLines } from './protocol'

describe('Pi RPC JSONL protocol parser', () => {
  it.effect('classifies RPC responses separately from streamed events', () =>
    Effect.sync(() => {
      const parsed = parsePiRpcJsonLines([
        JSON.stringify({ id: '1', type: 'response', command: 'prompt', success: true }),
        JSON.stringify({ type: 'agent_start' }),
        '{bad',
        JSON.stringify({ id: '2', type: 'response', command: 'abort', success: false, error: 'nope' }),
      ].join('\n'))

      expect(parsed.records).toEqual([
        { kind: 'response', value: { id: '1', type: 'response', command: 'prompt', success: true } },
        { kind: 'event', value: { type: 'agent_start' } },
        { kind: 'response', value: { id: '2', type: 'response', command: 'abort', success: false, error: 'nope' } },
      ])
      expect(parsed.parseErrors).toHaveLength(1)
    }))

  it.effect('parses events without requiring Effect wrapper compatibility', () =>
    Effect.sync(() => {
      const parsed = parsePiRpcJsonLines('{"type":"agent_end"}\n')
      expect(parsed.records).toEqual([{ kind: 'event', value: { type: 'agent_end' } }])
    }))
})
