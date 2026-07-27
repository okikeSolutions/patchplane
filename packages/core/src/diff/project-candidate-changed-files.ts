import { Effect, Match, Option, Schema } from 'effect'
import {
  CandidateFilePath,
  type CandidateFilePath as CandidateFilePathType,
} from '@patchplane/domain/candidate-file'

export type CandidateChangedFile = {
  readonly path: CandidateFilePathType
  readonly previousPath?: CandidateFilePathType | undefined
  readonly changeKind:
    | 'added'
    | 'modified'
    | 'deleted'
    | 'renamed'
    | 'copied'
    | 'type-changed'
    | 'unmerged'
  readonly contentKind: 'text' | 'binary' | 'submodule' | 'unknown'
  readonly additions?: number | undefined
  readonly deletions?: number | undefined
  readonly oldMode?: string | undefined
  readonly newMode?: string | undefined
}

export type CandidateChangedFilesProjection = {
  readonly files: readonly CandidateChangedFile[]
  readonly artifactTruncated: boolean
  readonly parseComplete: boolean
  readonly unsupportedRecords: number
}

const decodeQuotedGitPath = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.String),
)
const decodeCandidateFilePath = Schema.decodeUnknownOption(CandidateFilePath)

function candidateFilePath(value: string | undefined) {
  return Match.value(value).pipe(
    Match.when(undefined, () => undefined),
    Match.orElse((path) =>
      Option.getOrUndefined(decodeCandidateFilePath(path)),
    ),
  )
}

function decodeGitPath(value: string) {
  const trimmed = value.trim()
  return Match.value(trimmed).pipe(
    Match.when('/dev/null', () => undefined),
    Match.when(
      (path) => !path.startsWith('"'),
      (path) => path,
    ),
    Match.orElse((path) =>
      Option.getOrUndefined(decodeQuotedGitPath(path)),
    ),
  )
}

function stripGitPrefix(value: string | undefined) {
  return Match.value(value).pipe(
    Match.when(undefined, () => undefined),
    Match.when(
      (path) => path.startsWith('a/') || path.startsWith('b/'),
      (path) => path.slice(2),
    ),
    Match.orElse((path) => path),
  )
}

function metadataPath(lines: readonly string[], prefix: string) {
  const line = lines.find((candidate) => candidate.startsWith(prefix))
  return Match.value(line).pipe(
    Match.when(undefined, () => undefined),
    Match.orElse((matchedLine) =>
      decodeGitPath(matchedLine.slice(prefix.length)),
    ),
  )
}

function fileHeaderPath(lines: readonly string[], prefix: '--- ' | '+++ ') {
  const line = lines.find((candidate) => candidate.startsWith(prefix))
  return Match.value(line).pipe(
    Match.when(undefined, () => undefined),
    Match.orElse((matchedLine) => {
      const rawPath = matchedLine.slice(prefix.length).split('\t', 1)[0]
      return stripGitPrefix(decodeGitPath(rawPath ?? ''))
    }),
  )
}

function diffHeaderPaths(header: string) {
  return Match.value(/^diff --git a\/(.+) b\/(.+)$/.exec(header)).pipe(
    Match.when(null, () => undefined),
    Match.orElse((matchedHeader) => ({
      previousPath: matchedHeader[1],
      path: matchedHeader[2],
    })),
  )
}

function combinedDiffPath(header: string) {
  return Match.value(/^diff --(?:cc|combined) (.+)$/.exec(header)).pipe(
    Match.when(null, () => undefined),
    Match.orElse((matchedHeader) => decodeGitPath(matchedHeader[1] ?? '')),
  )
}

function mode(lines: readonly string[], prefix: string) {
  const line = lines.find((candidate) => candidate.startsWith(prefix))
  return Match.value(line).pipe(
    Match.when(undefined, () => undefined),
    Match.orElse(
      (matchedLine) => matchedLine.slice(prefix.length).trim() || undefined,
    ),
  )
}

function changedLineCounts(lines: readonly string[]) {
  let additions = 0
  let deletions = 0
  let inHunk = false
  for (const line of lines) {
    Match.value(line).pipe(
      Match.when(
        (candidateLine) => candidateLine.startsWith('@@ '),
        () => {
          inHunk = true
        },
      ),
      Match.when(
        () => !inHunk,
        () => undefined,
      ),
      Match.when(
        (candidateLine) =>
          candidateLine.startsWith('\\ No newline at end of file'),
        () => undefined,
      ),
      Match.when(
        (candidateLine) => candidateLine.startsWith('+'),
        () => {
          additions += 1
        },
      ),
      Match.when(
        (candidateLine) => candidateLine.startsWith('-'),
        () => {
          deletions += 1
        },
      ),
      Match.orElse(() => undefined),
    )
  }
  return { additions, deletions }
}

function projectRecord(
  lines: readonly string[],
): CandidateChangedFile | undefined {
  const header = lines[0] ?? ''
  const headerPaths = diffHeaderPaths(header)
  const unmergedPath = combinedDiffPath(header)
  const renamedFrom = metadataPath(lines, 'rename from ')
  const renamedTo = metadataPath(lines, 'rename to ')
  const copiedFrom = metadataPath(lines, 'copy from ')
  const copiedTo = metadataPath(lines, 'copy to ')
  const previousPath =
    renamedFrom ??
    copiedFrom ??
    fileHeaderPath(lines, '--- ') ??
    headerPaths?.previousPath
  const path =
    renamedTo ??
    copiedTo ??
    fileHeaderPath(lines, '+++ ') ??
    headerPaths?.path ??
    unmergedPath
  const oldMode = mode(lines, 'old mode ')
  const newMode = mode(lines, 'new mode ')
  const isSubmodule =
    oldMode === '160000' ||
    newMode === '160000' ||
    lines.some(
      (diffLine) =>
        /^index \S+\.\.\S+ 160000$/.test(diffLine) ||
        /^[+-]?Subproject commit /.test(diffLine),
    )
  const isBinary = lines.some(
    (diffLine) =>
      diffLine === 'GIT binary patch' ||
      (diffLine.startsWith('Binary files ') && diffLine.endsWith(' differ')),
  )
  const hasHunk = lines.some((diffLine) => diffLine.startsWith('@@ '))
  const counts = changedLineCounts(lines)
  const changeKind = Match.value({
    unmerged: unmergedPath !== undefined,
    renamed: renamedTo !== undefined,
    copied: copiedTo !== undefined,
    added: lines.some((diffLine) => diffLine.startsWith('new file mode ')),
    deleted: lines.some((diffLine) =>
      diffLine.startsWith('deleted file mode '),
    ),
    modeChanged: oldMode !== undefined || newMode !== undefined,
  }).pipe(
    Match.when({ unmerged: true }, () => 'unmerged' as const),
    Match.when({ renamed: true }, () => 'renamed' as const),
    Match.when({ copied: true }, () => 'copied' as const),
    Match.when({ added: true }, () => 'added' as const),
    Match.when({ deleted: true }, () => 'deleted' as const),
    Match.when({ modeChanged: true }, () => 'type-changed' as const),
    Match.orElse(() => 'modified' as const),
  )
  const contentKind = Match.value({ isSubmodule, isBinary, hasHunk }).pipe(
    Match.when({ isSubmodule: true }, () => 'submodule' as const),
    Match.when({ isBinary: true }, () => 'binary' as const),
    Match.when({ hasHunk: true }, () => 'text' as const),
    Match.orElse(() => 'unknown' as const),
  )

  const candidatePath = candidateFilePath(path)
  const candidatePreviousPath = candidateFilePath(previousPath)

  return Match.value(candidatePath).pipe(
    Match.when(
      (matchedPath): matchedPath is CandidateFilePathType =>
        matchedPath !== undefined,
      (matchedPath) => ({
        path: matchedPath,
        ...(candidatePreviousPath === undefined ||
        candidatePreviousPath === matchedPath
          ? {}
          : { previousPath: candidatePreviousPath }),
        changeKind,
        contentKind,
        ...(hasHunk ? counts : {}),
        ...(oldMode === undefined ? {} : { oldMode }),
        ...(newMode === undefined ? {} : { newMode }),
      }),
    ),
    Match.orElse(() => undefined),
  )
}

export const ProjectCandidateChangedFiles = Effect.fn(
  '@patchplane/core/diff/ProjectCandidateChangedFiles',
)(
  (
    content: string,
    options?: { readonly artifactTruncated?: boolean | undefined },
  ) =>
    Effect.sync(() => {
      const records: string[][] = []
      let currentRecord: string[] | undefined
      let unsupportedRecords = 0

      for (const rawLine of content.split('\n')) {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
        Match.value(line).pipe(
          Match.when(
            (candidateLine) =>
              candidateLine.startsWith('diff --git ') ||
              candidateLine.startsWith('diff --cc ') ||
              candidateLine.startsWith('diff --combined '),
            (matchedLine) => {
              Match.value(currentRecord).pipe(
                Match.when(undefined, () => undefined),
                Match.orElse((record) => records.push(record)),
              )
              currentRecord = [matchedLine]
            },
          ),
          Match.when(
            (candidateLine) => candidateLine.startsWith('diff --'),
            () => {
              Match.value(currentRecord).pipe(
                Match.when(undefined, () => undefined),
                Match.orElse((record) => records.push(record)),
              )
              currentRecord = undefined
              unsupportedRecords += 1
            },
          ),
          Match.orElse((unmatchedLine) => currentRecord?.push(unmatchedLine)),
        )
      }
      Match.value(currentRecord).pipe(
        Match.when(undefined, () => undefined),
        Match.orElse((record) => records.push(record)),
      )

      const files: CandidateChangedFile[] = []
      for (const record of records) {
        const file = projectRecord(record)
        Match.value(file).pipe(
          Match.when(undefined, () => {
            unsupportedRecords += 1
          }),
          Match.orElse((projectedFile) => files.push(projectedFile)),
        )
      }

      return {
        files,
        artifactTruncated: options?.artifactTruncated ?? false,
        parseComplete:
          content.trim().length > 0 &&
          records.length > 0 &&
          unsupportedRecords === 0,
        unsupportedRecords,
      } satisfies CandidateChangedFilesProjection
    }),
)
