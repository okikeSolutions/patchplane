import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { makePiRpcCommandSender } from './transport'

describe('Pi Effect RPC command transport', () => {
  it.effect('translates typed Effect RPC commands to Pi JSONL', () =>
    Effect.gen(function* () {
      const sent: string[] = []
      const pi = makePiRpcCommandSender({
        sendInput: (data) => Effect.sync(() => {
          sent.push(data)
        }),
      })

      yield* pi.getState({ id: 'state-1' })
      yield* pi.prompt({ id: 'prompt-1', message: 'hello' })
      yield* pi.steer({ id: 'steer-1', message: 'shorter' })
      yield* pi.followUp({ id: 'follow-1', message: 'next' })
      yield* pi.abort({ id: 'abort-1' })

      expect(sent).toEqual([
        '{"id":"state-1","type":"get_state"}\n',
        '{"id":"prompt-1","type":"prompt","message":"hello"}\n',
        '{"id":"steer-1","type":"steer","message":"shorter"}\n',
        '{"id":"follow-1","type":"follow_up","message":"next"}\n',
        '{"id":"abort-1","type":"abort"}\n',
      ])
    }))
})
