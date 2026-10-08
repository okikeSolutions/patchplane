import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit, Stream } from 'effect'
import { decodePiJsonlLines, maxPiJsonlLineCharacters } from './jsonl'

describe('Pi JSONL stream decoder', () => {
  it.effect('frames strict LF records across arbitrary chunks', () =>
    Effect.gen(function* () {
      const lines = yield* Stream.make(
        '{"type":"response"',
        '}\n{"type":"agent_start"}\r\n{"type":"partial"',
        '}',
      ).pipe(decodePiJsonlLines, Stream.runCollect)

      expect(Array.from(lines)).toEqual([
        { line: '{"type":"response"}', lineNumber: 1, sourceOffset: 0 },
        { line: '{"type":"agent_start"}', lineNumber: 2, sourceOffset: 20 },
        { line: '{"type":"partial"}', lineNumber: 3, sourceOffset: 44 },
      ])
    }),
  )

  it.effect('fails before an unterminated line can grow without bound', () =>
    Effect.gen(function* () {
      const exit = yield* Stream.make(
        'x'.repeat(maxPiJsonlLineCharacters + 1),
      ).pipe(decodePiJsonlLines, Stream.runCollect, Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.effect(
    'does not split on standalone carriage returns or unicode separators',
    () =>
      Effect.gen(function* () {
        const lines = yield* Stream.make(
          'alpha\rbeta',
          '\u2028gamma\u2029delta\n',
        ).pipe(decodePiJsonlLines, Stream.runCollect)

        expect(Array.from(lines)).toEqual([
          {
            line: 'alpha\rbeta\u2028gamma\u2029delta',
            lineNumber: 1,
            sourceOffset: 0,
          },
        ])
      }),
  )
})
