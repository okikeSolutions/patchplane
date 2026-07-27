import {
  lazy,
  Suspense,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { ArrowLeftIcon, CircleAlertIcon, ListTreeIcon } from 'lucide-react'
import type { CandidateChangedFilesProjection } from '@patchplane/core/diff/project-candidate-changed-files'
import type { CandidateFilePath } from '@patchplane/domain/candidate-file'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import * as m from '@/paraglide/messages'
import { candidateFileStatus } from './candidate-file-status'

const CandidateChangedFilesNavigator = lazy(() =>
  import('./candidate-changed-files-navigator').then((module) => ({
    default: module.CandidateChangedFilesNavigator,
  })),
)

const CandidateUnifiedDiff = import.meta.env.SSR
  ? undefined
  : lazy(() =>
      import('./candidate-unified-diff').then((module) => ({
        default: module.CandidateUnifiedDiff,
      })),
    )

type RenderedChangedFile = {
  readonly content: string
  readonly file: CandidateChangedFilesProjection['files'][number]
}

type ChangedFilesNavigatorHandle = {
  readonly revealPath: (path: CandidateFilePath) => boolean
}

type ColorScheme = 'dark' | 'light'

export function CandidateDiffRenderer({
  content,
  projection,
}: {
  readonly content: string
  readonly projection: CandidateChangedFilesProjection
}) {
  const colorScheme = usePatchPlaneColorScheme()
  const labelId = useId()
  const fileSections = useMemo(
    () => changedFileSections(content, projection),
    [content, projection],
  )
  const [selectedPath, setSelectedPath] = useState(
    () => fileSections[0]?.file.path,
  )
  const [mobileNavigatorOpen, setMobileNavigatorOpen] = useState(false)
  const sectionRefs = useRef(new Map<string, HTMLElement>())
  const headingRefs = useRef(new Map<string, HTMLHeadingElement>())
  const changedFilesHeadingRef = useRef<HTMLHeadingElement>(null)
  const desktopNavigatorRef = useRef<ChangedFilesNavigatorHandle>(null)
  const selectPath = useCallback((path: CandidateFilePath) => {
    setSelectedPath(path)
    setMobileNavigatorOpen(false)
    window.setTimeout(() => {
      const section = sectionRefs.current.get(path)
      const heading = headingRefs.current.get(path)
      section?.scrollIntoView?.({ block: 'start' })
      heading?.focus({ preventScroll: true })
    }, 0)
  }, [])
  const returnToChangedFile = useCallback((path: CandidateFilePath) => {
    desktopNavigatorRef.current?.revealPath(path)
    changedFilesHeadingRef.current?.focus()
  }, [])

  if (fileSections.length === 0 || selectedPath === undefined) {
    return (
      <div className="grid gap-3">
        <ChangedFilesProjectionNotice
          projection={projection}
          projectedFiles={fileSections.length}
          unavailable
        />
        <RawCandidateDiff content={content} />
      </div>
    )
  }
  const selectedFile = fileSections.find(
    ({ file }) => file.path === selectedPath,
  )?.file
  const selectedStatus =
    selectedFile === undefined ? undefined : candidateFileStatus(selectedFile)

  return (
    <div className="grid gap-3">
      {projection.artifactTruncated || !projection.parseComplete ? (
        <ChangedFilesProjectionNotice
          projection={projection}
          projectedFiles={fileSections.length}
        />
      ) : null}
      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <div className="grid lg:grid-cols-[minmax(13rem,17rem)_minmax(0,1fr)]">
          <nav
            aria-labelledby={labelId}
            className="hidden h-[clamp(24rem,48svh,34rem)] min-w-0 border-r border-border bg-muted/30 lg:block"
          >
            <div className="border-b border-border bg-muted/40 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <h3
                  id={labelId}
                  ref={changedFilesHeadingRef}
                  className="text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  tabIndex={-1}
                >
                  {projection.artifactTruncated || !projection.parseComplete
                    ? m.app_diff_partial_files()
                    : m.app_diff_changed_files()}
                </h3>
                <div className="flex items-center gap-1.5">
                  {projection.artifactTruncated || !projection.parseComplete ? (
                    <Badge variant="outline">{m.app_diff_partial()}</Badge>
                  ) : null}
                  <Badge variant="secondary">{fileSections.length}</Badge>
                </div>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {m.app_diff_candidate_only()}
              </p>
            </div>
            <Suspense
              fallback={
                <div
                  aria-label={m.app_diff_loading_files()}
                  className="flex flex-col gap-2 p-3"
                >
                  <Skeleton className="h-7 w-full" />
                  <Skeleton className="h-7 w-4/5" />
                  <Skeleton className="h-7 w-3/5" />
                </div>
              }
            >
              <CandidateChangedFilesNavigator
                files={fileSections.map(({ file }) => file)}
                selectedPath={selectedPath}
                onSelectPath={selectPath}
                partial={
                  projection.artifactTruncated || !projection.parseComplete
                }
                colorScheme={colorScheme}
                ref={desktopNavigatorRef}
              />
            </Suspense>
          </nav>
          <section
            aria-label={`${m.app_diff_for()} ${selectedPath}`}
            className="min-w-0 bg-background"
          >
            <div className="flex min-h-11 min-w-0 items-center gap-2 border-b border-border bg-muted/30 px-2 lg:hidden">
              <Sheet
                open={mobileNavigatorOpen}
                onOpenChange={setMobileNavigatorOpen}
              >
                <SheetTrigger
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-9 shrink-0"
                      aria-label={`${m.app_diff_browse()} ${String(fileSections.length)} ${m.app_diff_changed_files_lower()}`}
                    />
                  }
                >
                  <ListTreeIcon data-icon="inline-start" />
                  {m.app_diff_files()}
                  <Badge variant="secondary">{fileSections.length}</Badge>
                </SheetTrigger>
                <SheetContent
                  side="left"
                  className="w-[calc(100%_-_2rem)] max-w-[22rem] gap-0 border-border p-0"
                >
                  <SheetHeader className="border-b border-border pr-14">
                    <SheetTitle>
                      {projection.artifactTruncated || !projection.parseComplete
                        ? m.app_diff_partial_files()
                        : m.app_diff_changed_files()}
                    </SheetTitle>
                    <SheetDescription>
                      {m.app_diff_candidate_only()}
                    </SheetDescription>
                  </SheetHeader>
                  <nav
                    aria-label={m.app_diff_changed_files()}
                    className="min-h-0 flex-1 bg-muted/30"
                  >
                    <Suspense
                      fallback={
                        <div
                          aria-label={m.app_diff_loading_files()}
                          className="flex flex-col gap-2 p-3"
                        >
                          <Skeleton className="h-7 w-full" />
                          <Skeleton className="h-7 w-4/5" />
                          <Skeleton className="h-7 w-3/5" />
                        </div>
                      }
                    >
                      <CandidateChangedFilesNavigator
                        files={fileSections.map(({ file }) => file)}
                        selectedPath={selectedPath}
                        onSelectPath={selectPath}
                        partial={
                          projection.artifactTruncated ||
                          !projection.parseComplete
                        }
                        colorScheme={colorScheme}
                      />
                    </Suspense>
                  </nav>
                </SheetContent>
              </Sheet>
              <span
                className="min-w-0 flex-1 truncate font-mono text-xs font-medium"
                title={selectedPath}
              >
                {selectedPath}
              </span>
              {selectedStatus === undefined ? null : (
                <Badge variant="secondary" className="shrink-0">
                  {selectedStatus.changeLabel}
                </Badge>
              )}
            </div>
            <ScrollArea className="h-[clamp(24rem,48svh,34rem)]">
              <div>
                {fileSections.map((file, index) => {
                  const selected = file.file.path === selectedPath
                  const status = candidateFileStatus(file.file)
                  const headingId = `${labelId}-file-${String(index)}`
                  return (
                    <section
                      key={`${String(index)}:${file.file.path}`}
                      ref={(element) => {
                        if (element === null)
                          sectionRefs.current.delete(file.file.path)
                        else sectionRefs.current.set(file.file.path, element)
                      }}
                      aria-labelledby={headingId}
                      className="min-w-0 scroll-mt-0 border-b border-border bg-background last:border-b-0"
                    >
                      <div
                        className={cn(
                          'flex min-w-0 items-center justify-between gap-3 border-b border-border px-3 py-2',
                          selected && 'bg-muted/40',
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="hidden lg:inline-flex"
                            title={m.app_diff_back_files()}
                            onClick={() => returnToChangedFile(file.file.path)}
                          >
                            <ArrowLeftIcon data-icon="inline-start" />
                            <span className="sr-only">
                              {m.app_diff_back_files()}
                            </span>
                          </Button>
                          <h3
                            id={headingId}
                            ref={(element) => {
                              if (element === null)
                                headingRefs.current.delete(file.file.path)
                              else
                                headingRefs.current.set(file.file.path, element)
                            }}
                            className="min-w-0 truncate font-mono text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                            tabIndex={-1}
                          >
                            {file.file.path}
                          </h3>
                        </div>
                        <div
                          aria-label={`${m.app_diff_file_status()}: ${status.changeLabel}; ${status.contentLabel}`}
                          className="flex shrink-0 items-center gap-1.5"
                        >
                          <Badge variant="secondary">
                            {status.changeLabel}
                          </Badge>
                          {file.file.contentKind === 'text' ? null : (
                            <Badge variant="outline">
                              {status.contentLabel}
                            </Badge>
                          )}
                        </div>
                      </div>
                      {file.file.contentKind === 'text' ? (
                        <UnifiedDiff
                          patch={file.content}
                          colorScheme={colorScheme}
                        />
                      ) : (
                        <NonTextualFileState file={file} />
                      )}
                    </section>
                  )
                })}
              </div>
            </ScrollArea>
          </section>
        </div>
      </div>
    </div>
  )
}

function ChangedFilesProjectionNotice({
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
    <Alert role="alert">
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

function NonTextualFileState({ file }: { readonly file: RenderedChangedFile }) {
  const message =
    file.file.contentKind === 'binary'
      ? m.app_diff_binary()
      : file.file.contentKind === 'submodule'
        ? m.app_diff_submodule()
        : m.app_diff_metadata()
  return (
    <Alert className="m-3">
      <CircleAlertIcon />
      <AlertTitle>{m.app_diff_no_hunk()}</AlertTitle>
      <AlertDescription>
        {message} {m.app_diff_inspect_artifact()}
      </AlertDescription>
    </Alert>
  )
}

function UnifiedDiff({
  patch,
  colorScheme,
}: {
  readonly patch: string
  readonly colorScheme: ColorScheme
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
    <Suspense fallback={fallback}>
      <CandidateUnifiedDiff patch={patch} colorScheme={colorScheme} />
    </Suspense>
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

function usePatchPlaneColorScheme(): ColorScheme {
  return useSyncExternalStore(
    subscribeToColorScheme,
    colorSchemeSnapshot,
    (): ColorScheme => 'light',
  )
}

function RawCandidateDiff({ content }: { readonly content: string }) {
  return (
    <ScrollArea className="h-[clamp(24rem,48svh,34rem)] rounded-lg border border-border bg-background">
      <pre className="break-words p-3 font-mono text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">
        {content}
      </pre>
    </ScrollArea>
  )
}

function changedFileSections(
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
