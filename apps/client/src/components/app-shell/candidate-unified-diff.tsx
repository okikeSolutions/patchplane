import { type CSSProperties, useId, useMemo } from 'react'
import { PatchDiff } from '@pierre/diffs/react'
import { projectAccessibleDiffHunks } from './candidate-diff-accessibility'
import * as m from '@/paraglide/messages'
import { getLocale } from '@/paraglide/runtime'
import type { WorkflowDiffView } from './workflow-diff-navigation'

const diffOptions = {
  diffIndicators: 'classic',
  disableFileHeader: true,
  hunkSeparators: 'metadata',
  overflow: 'scroll',
  preferredHighlighter: 'shiki-js',
  theme: {
    dark: 'github-dark-high-contrast',
    light: 'github-light-high-contrast',
  },
} as const

const diffStyle = {
  '--diffs-font-family': 'var(--font-mono)',
  '--diffs-font-size': '0.75rem',
  '--diffs-header-font-family': 'var(--font-sans)',
  '--diffs-line-height': '1.5',
} as CSSProperties

export function CandidateUnifiedDiff({
  patch,
  colorScheme,
  view,
}: {
  readonly patch: string
  readonly colorScheme: 'dark' | 'light'
  readonly view: WorkflowDiffView
}) {
  const transcriptId = useId()
  const locale = getLocale()
  const options = useMemo(
    () => ({ ...diffOptions, diffStyle: view, themeType: colorScheme }),
    [colorScheme, view],
  )
  const accessibleHunks = useMemo(
    () => projectAccessibleDiffHunks(patch, locale),
    [locale, patch],
  )
  return (
    <>
      {accessibleHunks.length === 0 ? null : (
        <div
          aria-label={
            view === 'split'
              ? m.app_diff_accessible_split()
              : m.app_diff_accessible()
          }
          className="sr-only"
          data-slot="accessible-unified-diff"
          role="document"
        >
          {accessibleHunks.map((hunk, index) => {
            const headingId = `${transcriptId}-hunk-${String(index)}`
            return (
              <section
                key={`${String(index)}:${hunk.heading}`}
                aria-labelledby={headingId}
              >
                <h4 id={headingId}>{hunk.heading}</h4>
                <pre>{hunk.lines.join('\n')}</pre>
              </section>
            )
          })}
        </div>
      )}
      <div aria-hidden={accessibleHunks.length > 0 ? 'true' : undefined}>
        <PatchDiff
          disableWorkerPool
          options={options}
          patch={patch}
          style={diffStyle}
        />
      </div>
    </>
  )
}
