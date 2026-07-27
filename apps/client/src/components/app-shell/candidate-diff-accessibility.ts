import * as m from '@/paraglide/messages'
import { getLocale } from '@/paraglide/runtime'

export type AccessibleDiffHunk = {
  readonly heading: string
  readonly lines: readonly string[]
}

const hunkHeaderPattern =
  /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: (.*))?$/

export function projectAccessibleDiffHunks(
  patch: string,
  locale: ReturnType<typeof getLocale> = getLocale(),
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
        heading: hunkHeading(
          {
            oldStart,
            oldCount,
            newStart,
            newCount,
            context: header[5],
          },
          locale,
        ),
        lines: [],
        oldLine: oldStart,
        newLine: newStart,
      }
      continue
    }
    if (current === undefined) continue
    if (line === '\\ No newline at end of file') {
      current.lines.push(m.app_diff_a11y_no_newline({}, { locale }))
      continue
    }
    const marker = line[0]
    const content = line.slice(1)
    if (marker === '+') {
      current.lines.push(
        lineAnnouncement('added', undefined, current.newLine, content, locale),
      )
      current.newLine += 1
      continue
    }
    if (marker === '-') {
      current.lines.push(
        lineAnnouncement(
          'deleted',
          current.oldLine,
          undefined,
          content,
          locale,
        ),
      )
      current.oldLine += 1
      continue
    }
    if (marker === ' ') {
      current.lines.push(
        lineAnnouncement(
          'unchanged',
          current.oldLine,
          current.newLine,
          content,
          locale,
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

function hunkHeading(
  input: {
    readonly oldStart: number
    readonly oldCount: number
    readonly newStart: number
    readonly newCount: number
    readonly context?: string | undefined
  },
  locale: ReturnType<typeof getLocale>,
) {
  const ranges = `${m.app_diff_a11y_hunk({}, { locale })} ${rangeLabel('old', input.oldStart, input.oldCount, locale)} ${rangeLabel('new', input.newStart, input.newCount, locale)}`
  return input.context === undefined || input.context.trim().length === 0
    ? ranges
    : `${ranges} ${m.app_diff_a11y_context({ context: input.context.trim() }, { locale })}`
}

function rangeLabel(
  label: 'new' | 'old',
  start: number,
  count: number,
  locale: ReturnType<typeof getLocale>,
) {
  if (count === 0) {
    return label === 'old'
      ? m.app_diff_a11y_old_file_empty({}, { locale })
      : m.app_diff_a11y_new_file_empty({}, { locale })
  }
  if (count === 1) {
    const input = { line: String(start) }
    return label === 'old'
      ? m.app_diff_a11y_old_line(input, { locale })
      : m.app_diff_a11y_new_line(input, { locale })
  }
  const input = {
    start: String(start),
    end: String(start + count - 1),
  }
  return label === 'old'
    ? m.app_diff_a11y_old_lines(input, { locale })
    : m.app_diff_a11y_new_lines(input, { locale })
}

function lineAnnouncement(
  kind: 'added' | 'deleted' | 'unchanged',
  oldLine: number | undefined,
  newLine: number | undefined,
  content: string,
  locale: ReturnType<typeof getLocale>,
) {
  const kindLabel =
    kind === 'added'
      ? m.app_diff_a11y_added({}, { locale })
      : kind === 'deleted'
        ? m.app_diff_a11y_deleted({}, { locale })
        : m.app_diff_a11y_unchanged({}, { locale })
  const code =
    content.length === 0 ? m.app_diff_a11y_blank_line({}, { locale }) : content
  return `${kindLabel} ${
    oldLine === undefined
      ? m.app_diff_a11y_old_not_applicable({}, { locale })
      : m.app_diff_a11y_old_line({ line: String(oldLine) }, { locale })
  } ${
    newLine === undefined
      ? m.app_diff_a11y_new_not_applicable({}, { locale })
      : m.app_diff_a11y_new_line({ line: String(newLine) }, { locale })
  } ${code}`
}
