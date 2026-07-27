export type AccessibleDiffHunk = {
  readonly heading: string
  readonly lines: readonly string[]
}

const hunkHeaderPattern =
  /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: (.*))?$/

export function projectAccessibleDiffHunks(
  patch: string,
): readonly AccessibleDiffHunk[] {
  const hunks: AccessibleDiffHunk[] = []
  let current:
    | {
        readonly heading: string
        readonly lines: string[]
        oldLine: number
        newLine: number
      }
    | undefined

  for (const rawLine of patch.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    const header = hunkHeaderPattern.exec(line)
    if (header !== null) {
      if (current !== undefined) {
        hunks.push({ heading: current.heading, lines: current.lines })
      }
      const oldStart = Number(header[1])
      const oldCount = header[2] === undefined ? 1 : Number(header[2])
      const newStart = Number(header[3])
      const newCount = header[4] === undefined ? 1 : Number(header[4])
      current = {
        heading: hunkHeading({
          oldStart,
          oldCount,
          newStart,
          newCount,
          context: header[5],
        }),
        lines: [],
        oldLine: oldStart,
        newLine: newStart,
      }
      continue
    }
    if (current === undefined) continue
    if (line === '\\ No newline at end of file') {
      current.lines.push('Note. No newline at end of file.')
      continue
    }
    const marker = line[0]
    const content = line.slice(1)
    if (marker === '+') {
      current.lines.push(
        lineAnnouncement('Added', undefined, current.newLine, content),
      )
      current.newLine += 1
      continue
    }
    if (marker === '-') {
      current.lines.push(
        lineAnnouncement('Deleted', current.oldLine, undefined, content),
      )
      current.oldLine += 1
      continue
    }
    if (marker === ' ') {
      current.lines.push(
        lineAnnouncement(
          'Unchanged',
          current.oldLine,
          current.newLine,
          content,
        ),
      )
      current.oldLine += 1
      current.newLine += 1
    }
  }
  if (current !== undefined) {
    hunks.push({ heading: current.heading, lines: current.lines })
  }
  return hunks
}

function hunkHeading(input: {
  readonly oldStart: number
  readonly oldCount: number
  readonly newStart: number
  readonly newCount: number
  readonly context?: string | undefined
}) {
  const ranges = `Hunk. ${rangeLabel('Old', input.oldStart, input.oldCount)} ${rangeLabel('New', input.newStart, input.newCount)}`
  return input.context === undefined || input.context.trim().length === 0
    ? ranges
    : `${ranges} Context: ${input.context.trim()}.`
}

function rangeLabel(label: 'New' | 'Old', start: number, count: number) {
  if (count === 0) return `${label} file has no lines in this hunk.`
  if (count === 1) return `${label} line ${String(start)}.`
  return `${label} lines ${String(start)} through ${String(start + count - 1)}.`
}

function lineAnnouncement(
  kind: 'Added' | 'Deleted' | 'Unchanged',
  oldLine: number | undefined,
  newLine: number | undefined,
  content: string,
) {
  const code = content.length === 0 ? 'Blank line.' : content
  return `${kind}. ${
    oldLine === undefined
      ? 'Old line not applicable.'
      : `Old line ${String(oldLine)}.`
  } ${
    newLine === undefined
      ? 'New line not applicable.'
      : `New line ${String(newLine)}.`
  } ${code}`
}
