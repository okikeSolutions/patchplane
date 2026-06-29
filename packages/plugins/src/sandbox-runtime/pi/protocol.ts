import { Option, Schema } from 'effect'

import { PiRpcCommandResponse } from './contract'

export type PiRpcParsedLine =
  | { readonly kind: 'response'; readonly value: PiRpcCommandResponse }
  | { readonly kind: 'event'; readonly value: unknown }

export interface PiRpcParseError {
  readonly line: string
  readonly error: string
}

export interface PiRpcParseResult {
  readonly records: ReadonlyArray<PiRpcParsedLine>
  readonly parseErrors: ReadonlyArray<PiRpcParseError>
}

function classifyPiRpcRecord(value: unknown): PiRpcParsedLine {
  const decoded = Schema.decodeUnknownOption(PiRpcCommandResponse)(value)
  if (Option.isSome(decoded)) return { kind: 'response', value: decoded.value }
  return { kind: 'event', value }
}

export function parsePiRpcJsonLines(input: string): PiRpcParseResult {
  const records: PiRpcParsedLine[] = []
  const parseErrors: PiRpcParseError[] = []

  const lines = input.split('\n').map((line) => line.endsWith('\r') ? line.slice(0, -1) : line)
  for (const line of lines) {
    if (line.length === 0) continue
    try {
      records.push(classifyPiRpcRecord(JSON.parse(line)))
    } catch (error) {
      parseErrors.push({
        line,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { records, parseErrors }
}
