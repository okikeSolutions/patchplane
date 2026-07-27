import { Effect, Match, Schema } from 'effect'
import type { CandidatePatchSetStats } from '@patchplane/domain/decision-review'

const defaultMaximumDiffBytes = 10_000_000
const hunkHeaderPattern = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@(?: .*)?$/

function utf8CodePointLength(value: string, index: number) {
  const codeUnit = value.charCodeAt(index)
  const nextCodeUnit =
    index + 1 < value.length ? value.charCodeAt(index + 1) : undefined
  return Match.value({ codeUnit, nextCodeUnit }).pipe(
    Match.when(
      ({ codeUnit: currentCodeUnit }) => currentCodeUnit <= 0x7f,
      () => ({ bytes: 1, codeUnits: 1 }) as const,
    ),
    Match.when(
      ({ codeUnit: currentCodeUnit }) => currentCodeUnit <= 0x7ff,
      () => ({ bytes: 2, codeUnits: 1 }) as const,
    ),
    Match.when(
      ({ codeUnit: currentCodeUnit, nextCodeUnit: followingCodeUnit }) =>
        currentCodeUnit >= 0xd800 &&
        currentCodeUnit <= 0xdbff &&
        followingCodeUnit !== undefined &&
        followingCodeUnit >= 0xdc00 &&
        followingCodeUnit <= 0xdfff,
      () => ({ bytes: 4, codeUnits: 2 }) as const,
    ),
    Match.orElse(() => ({ bytes: 3, codeUnits: 1 }) as const),
  )
}

function exceedsUtf8ByteLength(value: string, maximumBytes: number) {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const encoded = utf8CodePointLength(value, index)
    bytes += encoded.bytes
    index += encoded.codeUnits - 1
    if (bytes > maximumBytes) return true
  }
  return false
}

export const UnifiedDiffStatsUnavailableReason = Schema.Literals([
  'binary',
  'empty',
  'malformed',
  'oversized',
])
export type UnifiedDiffStatsUnavailableReason = Schema.Schema.Type<
  typeof UnifiedDiffStatsUnavailableReason
>

export class UnifiedDiffStatsUnavailable
  extends Schema.TaggedErrorClass<UnifiedDiffStatsUnavailable>()(
    'UnifiedDiffStatsUnavailable',
    {
      reason: UnifiedDiffStatsUnavailableReason,
    },
  ) {}

type UnifiedDiffStatsState = CandidatePatchSetStats & {
  readonly inFile: boolean
  readonly remainingOldLines?: number | undefined
  readonly remainingNewLines?: number | undefined
}

const malformedDiff = () =>
  new UnifiedDiffStatsUnavailable({ reason: 'malformed' })

function hunkIsComplete(state: UnifiedDiffStatsState) {
  return (
    state.remainingOldLines === undefined ||
    (state.remainingOldLines === 0 && state.remainingNewLines === 0)
  )
}

function beginFile(state: UnifiedDiffStatsState) {
  return Match.value(hunkIsComplete(state)).pipe(
    Match.when(true, () =>
      Effect.succeed({
        ...state,
        filesChanged: state.filesChanged + 1,
        inFile: true,
        remainingOldLines: undefined,
        remainingNewLines: undefined,
      }),
    ),
    Match.orElse(malformedDiff),
  )
}

function beginHunk(state: UnifiedDiffStatsState, line: string) {
  const header = hunkHeaderPattern.exec(line)
  return Match.value({ complete: hunkIsComplete(state), header }).pipe(
    Match.when(
      ({ complete, header: matchedHeader }) =>
        complete && matchedHeader !== null,
      ({ header: matchedHeader }) =>
        Effect.succeed({
          ...state,
          remainingOldLines:
            matchedHeader?.[1] === undefined ? 1 : Number(matchedHeader[1]),
          remainingNewLines:
            matchedHeader?.[2] === undefined ? 1 : Number(matchedHeader[2]),
        }),
    ),
    Match.orElse(malformedDiff),
  )
}

function consumeHunkLine(
  state: UnifiedDiffStatsState,
  input: {
    readonly oldLines: number
    readonly newLines: number
    readonly additions: number
    readonly deletions: number
  },
) {
  return Match.value({
    oldLines: state.remainingOldLines,
    newLines: state.remainingNewLines,
  }).pipe(
    Match.when(
      { oldLines: Match.number, newLines: Match.number },
      ({ oldLines, newLines }) => {
        const remainingOldLines = oldLines - input.oldLines
        const remainingNewLines = newLines - input.newLines
        return Match.value(
          remainingOldLines >= 0 && remainingNewLines >= 0,
        ).pipe(
          Match.when(true, () =>
            Effect.succeed({
              ...state,
              additions: state.additions + input.additions,
              deletions: state.deletions + input.deletions,
              remainingOldLines:
                remainingOldLines === 0 && remainingNewLines === 0
                  ? undefined
                  : remainingOldLines,
              remainingNewLines:
                remainingOldLines === 0 && remainingNewLines === 0
                  ? undefined
                  : remainingNewLines,
            }),
          ),
          Match.orElse(malformedDiff),
        )
      },
    ),
    Match.orElse(malformedDiff),
  )
}

const AdvanceUnifiedDiffStats = Effect.fnUntraced(function* (
  state: UnifiedDiffStatsState,
  line: string,
): Effect.fn.Return<UnifiedDiffStatsState, UnifiedDiffStatsUnavailable> {
  return yield* Match.value(line).pipe(
    Match.when(
      (candidateLine) => candidateLine.startsWith('diff --git '),
      () => beginFile(state),
    ),
    Match.when(
      () => !state.inFile,
      () => Effect.succeed(state),
    ),
    Match.when(
      (candidateLine) =>
        candidateLine === 'GIT binary patch' ||
        (candidateLine.startsWith('Binary files ') &&
          candidateLine.endsWith(' differ')),
      () => new UnifiedDiffStatsUnavailable({ reason: 'binary' }),
    ),
    Match.when(
      (candidateLine) => candidateLine.startsWith('@@ '),
      (matchedLine) => beginHunk(state, matchedLine),
    ),
    Match.when(
      () =>
        state.remainingOldLines === undefined ||
        state.remainingNewLines === undefined,
      () => Effect.succeed(state),
    ),
    Match.when(
      (candidateLine) =>
        candidateLine.startsWith('\\ No newline at end of file'),
      () => Effect.succeed(state),
    ),
    Match.when(
      (candidateLine) => candidateLine.startsWith('+'),
      () =>
        consumeHunkLine(state, {
          oldLines: 0,
          newLines: 1,
          additions: 1,
          deletions: 0,
        }),
    ),
    Match.when(
      (candidateLine) => candidateLine.startsWith('-'),
      () =>
        consumeHunkLine(state, {
          oldLines: 1,
          newLines: 0,
          additions: 0,
          deletions: 1,
        }),
    ),
    Match.when(
      (candidateLine) => candidateLine.startsWith(' '),
      () =>
        consumeHunkLine(state, {
          oldLines: 1,
          newLines: 1,
          additions: 0,
          deletions: 0,
        }),
    ),
    Match.orElse(malformedDiff),
  )
})

export const ParseUnifiedDiffStats = Effect.fn(
  '@patchplane/core/diff/ParseUnifiedDiffStats',
)(function* (
  diff: string,
  options?: { readonly maximumBytes?: number | undefined },
) {
  const maximumBytes = options?.maximumBytes ?? defaultMaximumDiffBytes
  yield* Match.value({
    oversized: exceedsUtf8ByteLength(diff, maximumBytes),
    empty: diff.trim().length === 0,
  }).pipe(
    Match.when(
      { oversized: true },
      () => new UnifiedDiffStatsUnavailable({ reason: 'oversized' }),
    ),
    Match.when(
      { empty: true },
      () => new UnifiedDiffStatsUnavailable({ reason: 'empty' }),
    ),
    Match.orElse(() => Effect.void),
  )

  let state: UnifiedDiffStatsState = {
    filesChanged: 0,
    additions: 0,
    deletions: 0,
    inFile: false,
  }
  for (const rawLine of diff.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    state = yield* AdvanceUnifiedDiffStats(state, line)
  }

  return yield* Match.value({
    hasFiles: state.filesChanged > 0,
    complete: hunkIsComplete(state),
  }).pipe(
    Match.when({ hasFiles: true, complete: true }, () =>
      Effect.succeed({
        filesChanged: state.filesChanged,
        additions: state.additions,
        deletions: state.deletions,
      } satisfies CandidatePatchSetStats),
    ),
    Match.orElse(malformedDiff),
  )
})
