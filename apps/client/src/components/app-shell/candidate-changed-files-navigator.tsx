import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
} from 'react'
import type { CSSProperties } from 'react'
import {
  prepareFileTreeInput,
  type FileTreeRowDecorationRenderer,
  type GitStatus,
  type GitStatusEntry,
} from '@pierre/trees'
import {
  FileTree,
  useFileTree,
  useFileTreeSearch,
  useFileTreeSelection,
} from '@pierre/trees/react'
import type { CandidateChangedFile } from '@patchplane/core/diff/project-candidate-changed-files'
import type { CandidateFilePath } from '@patchplane/domain/candidate-file'
import * as m from '@/paraglide/messages'
import { candidateFileStatus } from './candidate-file-status'

function changedFileCountByFolder(files: readonly CandidateChangedFile[]) {
  const counts = new Map<string, number>()
  for (const { path } of files) {
    let separatorIndex = path.indexOf('/')
    while (separatorIndex !== -1) {
      const folderPath = path.slice(0, separatorIndex + 1)
      counts.set(folderPath, (counts.get(folderPath) ?? 0) + 1)
      separatorIndex = path.indexOf('/', separatorIndex + 1)
    }
  }
  return counts
}

export type CandidateChangedFilesNavigatorHandle = {
  readonly revealPath: (path: CandidateFilePath) => boolean
}

function gitStatusForChangedFile(file: CandidateChangedFile): GitStatusEntry {
  const status = {
    added: 'added',
    copied: 'added',
    deleted: 'deleted',
    modified: 'modified',
    renamed: 'renamed',
    'type-changed': 'modified',
    unmerged: 'modified',
  } as const satisfies Record<CandidateChangedFile['changeKind'], GitStatus>
  return { path: file.path, status: status[file.changeKind] }
}

export const CandidateChangedFilesNavigator = forwardRef<
  CandidateChangedFilesNavigatorHandle,
  {
    readonly files: readonly CandidateChangedFile[]
    readonly selectedPath: CandidateFilePath
    readonly onSelectPath: (path: CandidateFilePath) => void
    readonly partial?: boolean
    readonly colorScheme?: 'dark' | 'light'
  }
>(function CandidateChangedFilesNavigator(
  { files, selectedPath, onSelectPath, partial = false, colorScheme = 'light' },
  ref,
) {
  const descriptionId = useId()
  const statusId = useId()
  const paths = useMemo(() => files.map(({ path }) => path), [files])
  const preparedInput = useMemo(
    () => prepareFileTreeInput(paths, { flattenEmptyDirectories: true }),
    [paths],
  )
  const gitStatus = useMemo(() => files.map(gitStatusForChangedFile), [files])
  const filePaths = useMemo(() => new Set<string>(paths), [paths])
  const filesByPath = useMemo(
    () =>
      new Map<string, CandidateChangedFile>(
        files.map((file) => [file.path, file]),
      ),
    [files],
  )
  const folderCounts = useMemo(() => changedFileCountByFolder(files), [files])
  const handleSelectionChange = useCallback(
    (selectedPaths: readonly string[]) => {
      const latestSelectedPath = selectedPaths.at(-1)
      if (
        latestSelectedPath !== undefined &&
        filePaths.has(latestSelectedPath)
      ) {
        const selectedFile = filesByPath.get(latestSelectedPath)
        if (selectedFile !== undefined) onSelectPath(selectedFile.path)
      }
    },
    [filePaths, filesByPath, onSelectPath],
  )
  const renderRowDecoration = useCallback<FileTreeRowDecorationRenderer>(
    ({ item }) => {
      const file = filesByPath.get(item.path)
      if (file !== undefined) {
        const status = candidateFileStatus(file)
        return { text: status.marker, title: status.title }
      }
      const changedFiles = folderCounts.get(item.path)
      if (changedFiles === undefined) return null
      const fileLabel = changedFiles === 1 ? 'file' : 'files'
      const folderLabel = item.path.endsWith('/')
        ? item.path.slice(0, -1)
        : item.path
      return {
        text: `${String(changedFiles)} changed`,
        title: `Candidate diff includes ${String(changedFiles)} changed ${fileLabel} under ${folderLabel}; full repository contents are not shown`,
      }
    },
    [filesByPath, folderCounts],
  )
  const { model } = useFileTree({
    density: 'compact',
    fileTreeSearchMode: 'hide-non-matches',
    flattenEmptyDirectories: true,
    gitStatus,
    initialExpansion: 'open',
    initialSelectedPaths: [selectedPath],
    onSelectionChange: handleSelectionChange,
    overscan: 12,
    preparedInput,
    renderRowDecoration,
    search: true,
    searchBlurBehavior: 'retain',
    searchFakeFocus: true,
    stickyFolders: true,
  })
  const selectedPaths = useFileTreeSelection(model)
  const search = useFileTreeSearch(model)

  useEffect(() => {
    const item = model.getItem(selectedPath)
    if (item !== null && !item.isSelected()) item.select()
  }, [model, selectedPath])

  useImperativeHandle(
    ref,
    () => ({
      revealPath(path) {
        if (model.getItem(path) === null) return false
        model.scrollToPath(path, { focus: true, offset: 'nearest' })
        return true
      },
    }),
    [model],
  )

  return (
    <>
      <p className="sr-only" id={descriptionId}>
        {m.app_diff_candidate_only()}
        {partial ? ` ${m.app_diff_projection_partial()}` : ''}
        {` ${m.app_diff_decorations()}`}
      </p>
      <output aria-live="polite" className="sr-only" id={statusId}>
        {search.isOpen
          ? `${String(search.matchingPaths.length)} ${
              search.matchingPaths.length === 1
                ? m.app_diff_match()
                : m.app_diff_matches()
            } ${m.app_diff_for_search()} ${search.value.length === 0 ? m.app_diff_empty_search() : search.value}.`
          : `${selectedPaths.at(-1) ?? selectedPath} ${m.app_diff_selected()}.`}
      </output>
      <FileTree
        aria-describedby={`${descriptionId} ${statusId}`}
        aria-label={m.app_diff_candidate_files()}
        model={model}
        style={
          {
            height: '100%',
            width: '100%',
            colorScheme,
            '--trees-bg-override': 'var(--background)',
            '--trees-bg-muted-override': 'var(--muted)',
            '--trees-border-color-override': 'var(--border)',
            '--trees-fg-override': 'var(--foreground)',
            '--trees-fg-muted-override': 'var(--muted-foreground)',
            '--trees-font-family-override': 'var(--font-sans)',
            '--trees-focus-ring-color-override': 'var(--ring)',
            '--trees-focus-ring-width-override': '2px',
            '--trees-scrollbar-thumb-override': 'var(--border)',
            '--trees-selected-bg-override': 'var(--accent)',
            '--trees-selected-fg-override': 'var(--accent-foreground)',
          } as CSSProperties
        }
      />
    </>
  )
})
