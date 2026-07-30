import { lazy, Suspense, useSyncExternalStore } from 'react'
import { CircleAlertIcon } from 'lucide-react'
import type { CandidateChangedFilesProjection } from '@patchplane/core/diff/project-candidate-changed-files'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import * as m from '@/paraglide/messages'
import {
  CandidateDiffFailureBoundary,
  CandidateDiffProcessorUnavailableError,
  type CandidateDiffRendererFailure,
} from './candidate-diff-failure-boundary'
import type { WorkflowDiffView } from './workflow-diff-navigation'

const CandidateUnifiedDiff = import.meta.env.SSR
  ? undefined
  : lazy(() =>
      import('./candidate-unified-diff')
        .then((module) => ({ default: module.CandidateUnifiedDiff }))
        .catch(() => {
          throw new CandidateDiffProcessorUnavailableError()
        }),
    )

type RenderedChangedFile = {
  readonly content: string
  readonly file: CandidateChangedFilesProjection['files'][number]
}

type ColorScheme = 'dark' | 'light'

export function ChangedFilesProjectionNotice({
  projection,
  projectedFiles,
  unavailable = false,
}: {
  readonly projection: CandidateChangedFilesProjection
  readonly projectedFiles: number
  readonly unavailable?: boolean
}) {
  const reasons = [
    ...(projection.artifactTruncated ? [m.app_diff_reason_partial()] : []),
    ...(!projection.parseComplete ? [m.app_diff_reason_parse()] : []),
    ...(projection.unsupportedRecords > 0
      ? [
          `${String(projection.unsupportedRecords)} ${
            projection.unsupportedRecords === 1
              ? m.app_diff_reason_record()
              : m.app_diff_reason_records()
          }`,
        ]
      : []),
  ]
  return (
    <Alert role="alert" variant="warning">
      <CircleAlertIcon />
      <AlertTitle>
        {unavailable
          ? m.app_diff_navigation_unavailable()
          : m.app_diff_list_partial()}
      </AlertTitle>
      <AlertDescription className="grid gap-2">
        <p className="m-0">
          {reasons.length === 0
            ? m.app_diff_no_paths()
            : `${m.app_diff_incomplete()} ${reasons.join(` ${m.app_diff_and()} `)}.`}
        </p>
        <p className="m-0">
          {projectedFiles === 0
            ? m.app_diff_no_safe_path()
            : `${m.app_diff_only()} ${String(projectedFiles)} ${
                projectedFiles === 1
                  ? m.app_diff_path_shown()
                  : m.app_diff_paths_shown()
              }`}{' '}
          {m.app_diff_not_complete()}
        </p>
      </AlertDescription>
    </Alert>
  )
}

export function NonTextualFileState({
  file,
}: {
  readonly file: RenderedChangedFile
}) {
  const message =
    file.file.contentKind === 'binary'
      ? m.app_diff_binary()
      : file.file.contentKind === 'submodule'
        ? m.app_diff_submodule()
        : m.app_diff_metadata()
  return (
    <Alert className="m-3" variant="warning">
      <CircleAlertIcon />
      <AlertTitle>{m.app_diff_no_hunk()}</AlertTitle>
      <AlertDescription>
        {message} {m.app_diff_inspect_artifact()}
      </AlertDescription>
    </Alert>
  )
}

export function UnifiedDiff({
  patch,
  colorScheme,
  view,
  onFailure,
}: {
  readonly patch: string
  readonly colorScheme: ColorScheme
  readonly view: WorkflowDiffView
  readonly onFailure?: (failure: CandidateDiffRendererFailure) => void
}) {
  const fallback = (
    <div
      aria-label={m.app_diff_loading_unified()}
      className="flex flex-col gap-2 p-3"
    >
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-5 w-11/12" />
      <Skeleton className="h-5 w-4/5" />
    </div>
  )
  if (CandidateUnifiedDiff === undefined) return fallback
  return (
    <CandidateDiffFailureBoundary
      fallbackKind="malformed"
      onFailure={onFailure}
    >
      <Suspense fallback={fallback}>
        <CandidateUnifiedDiff
          patch={patch}
          colorScheme={colorScheme}
          view={view}
        />
      </Suspense>
    </CandidateDiffFailureBoundary>
  )
}

function colorSchemeSnapshot(): ColorScheme {
  if (typeof document === 'undefined') return 'light'
  if (document.documentElement.classList.contains('dark')) return 'dark'
  if (document.documentElement.classList.contains('light')) return 'light'
  return typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function subscribeToColorScheme(onChange: () => void) {
  const mediaQuery = window.matchMedia?.('(prefers-color-scheme: dark)')
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributeFilter: ['class'],
    attributes: true,
  })
  mediaQuery?.addEventListener('change', onChange)
  return () => {
    observer.disconnect()
    mediaQuery?.removeEventListener('change', onChange)
  }
}

export function usePatchPlaneColorScheme(): ColorScheme {
  return useSyncExternalStore(
    subscribeToColorScheme,
    colorSchemeSnapshot,
    (): ColorScheme => 'light',
  )
}

export function RawCandidateDiff({
  content,
  expanded = false,
}: {
  readonly content: string
  readonly expanded?: boolean
}) {
  return (
    <ScrollArea
      className={cn(
        'rounded-lg border border-border bg-background',
        expanded
          ? 'h-[calc(100svh-13rem)] min-h-[28rem]'
          : 'h-[clamp(24rem,48svh,34rem)]',
      )}
    >
      <pre className="break-words p-3 font-mono text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">
        {content}
      </pre>
    </ScrollArea>
  )
}

export function changedFileSections(
  content: string,
  projection: CandidateChangedFilesProjection,
): readonly RenderedChangedFile[] {
  const records: string[][] = []
  let currentRecord: string[] | undefined
  for (const line of content.split('\n')) {
    if (
      line.startsWith('diff --git ') ||
      line.startsWith('diff --cc ') ||
      line.startsWith('diff --combined ')
    ) {
      if (currentRecord !== undefined) records.push(currentRecord)
      currentRecord = [line]
    } else {
      currentRecord?.push(line)
    }
  }
  if (currentRecord !== undefined) records.push(currentRecord)
  if (records.length !== projection.files.length) return []
  return projection.files.flatMap((file, index) => {
    const record = records[index]
    return record === undefined ? [] : [{ content: record.join('\n'), file }]
  })
}
