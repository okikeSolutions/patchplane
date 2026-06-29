import { Stream } from 'effect'

function stripTrailingCarriageReturn(line: string) {
  return line.endsWith('\r') ? line.slice(0, -1) : line
}

export interface PiJsonlLine {
  readonly line: string
  readonly lineNumber: number
  readonly sourceOffset: number
}

interface JsonlState {
  readonly buffer: string
  readonly lineNumber: number
  readonly offset: number
}

/**
 * Pi RPC/JSON modes use strict LF JSONL framing. Split only on `\n` and strip
 * a single trailing `\r` before the LF for CRLF compatibility. Do not use
 * generic line splitting helpers that treat standalone `\r`, U+2028, or U+2029
 * as record delimiters.
 */
export function decodePiJsonlLines<E, R>(chunks: Stream.Stream<string, E, R>): Stream.Stream<PiJsonlLine, E, R> {
  return chunks.pipe(
    Stream.mapAccumArray(
      () => ({ buffer: '', lineNumber: 0, offset: 0 }) satisfies JsonlState,
      (state, chunkGroup) => {
        let buffer = state.buffer
        let lineNumber = state.lineNumber
        let offset = state.offset
        const lines: PiJsonlLine[] = []

        for (const chunk of chunkGroup) {
          buffer += chunk
          while (true) {
            const newlineAt = buffer.indexOf('\n')
            if (newlineAt === -1) break
            const rawLine = buffer.slice(0, newlineAt)
            lines.push({
              line: stripTrailingCarriageReturn(rawLine),
              lineNumber: lineNumber + 1,
              sourceOffset: offset,
            })
            lineNumber += 1
            offset += rawLine.length + 1
            buffer = buffer.slice(newlineAt + 1)
          }
        }

        return [{ buffer, lineNumber, offset }, lines]
      },
      {
        onHalt: (state) =>
          state.buffer.length === 0
            ? []
            : [{
              line: stripTrailingCarriageReturn(state.buffer),
              lineNumber: state.lineNumber + 1,
              sourceOffset: state.offset,
            }],
      },
    ),
  )
}
