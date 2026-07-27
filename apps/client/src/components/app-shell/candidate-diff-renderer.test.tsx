// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type {
  CandidateChangedFile,
  CandidateChangedFilesProjection,
} from '@patchplane/core/diff/project-candidate-changed-files'
import { makeCandidateFilePath } from '@patchplane/domain/candidate-file'
import { CandidateDiffRenderer } from './candidate-diff-renderer'
import { CandidateChangedFilesNavigator } from './candidate-changed-files-navigator'
import { projectAccessibleDiffHunks } from './candidate-diff-accessibility'

class ResizeObserverMock {
  readonly disconnect = vi.fn()
  readonly observe = vi.fn()
  readonly unobserve = vi.fn()
}

const content = `diff --git a/src/first.ts b/src/first.ts
--- a/src/first.ts
+++ b/src/first.ts
@@ -1 +1 @@
-const firstValue: boolean = false
+const firstValue: boolean = true
diff --git a/src/second.ts b/src/second.ts
--- a/src/second.ts
+++ b/src/second.ts
@@ -1 +1 @@
-const secondValue: boolean = false
+const secondValue: boolean = true
`

function candidateFiles(
  files: readonly (Omit<CandidateChangedFile, 'path' | 'previousPath'> & {
    readonly path: string
    readonly previousPath?: string | undefined
  })[],
): readonly CandidateChangedFile[] {
  return files.map(({ path, previousPath, ...file }) => ({
    ...file,
    path: makeCandidateFilePath(path),
    ...(previousPath === undefined
      ? {}
      : { previousPath: makeCandidateFilePath(previousPath) }),
  }))
}

const projection: CandidateChangedFilesProjection = {
  files: candidateFiles([
    {
      path: 'src/first.ts',
      changeKind: 'modified' as const,
      contentKind: 'text' as const,
      additions: 1,
      deletions: 1,
    },
    {
      path: 'src/second.ts',
      changeKind: 'modified' as const,
      contentKind: 'text' as const,
      additions: 1,
      deletions: 1,
    },
  ]),
  artifactTruncated: false,
  parseComplete: true,
  unsupportedRecords: 0,
}

describe('CandidateDiffRenderer changed-file navigation', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
      configurable: true,
      value: () => [],
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(HTMLElement.prototype, 'getAnimations')
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    document.documentElement.classList.remove('dark', 'light')
  })

  test('renders Pierre unified diffs and selects a tree file', async () => {
    const networkRequest = vi.fn()
    vi.stubGlobal('fetch', networkRequest)
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })

    const { container } = render(
      <CandidateDiffRenderer content={content} projection={projection} />,
    )

    const diffHosts = await waitFor(
      () => {
        const hosts = container.querySelectorAll('diffs-container')
        expect(hosts).toHaveLength(2)
        return hosts
      },
      { timeout: 3_000 },
    )
    await waitFor(() => {
      for (const host of diffHosts) {
        expect(
          host.shadowRoot?.querySelector('pre')?.getAttribute('data-diff-type'),
        ).toBe('single')
      }
    })
    await waitFor(() => {
      const syntaxTokens = diffHosts[0]?.shadowRoot?.querySelectorAll(
        'code[data-code] span[style]',
      )
      expect(syntaxTokens?.length).toBeGreaterThan(2)
      expect(
        [...(syntaxTokens ?? [])].some((token) =>
          token.textContent?.includes('boolean'),
        ),
      ).toBe(true)
    })
    expect(networkRequest).not.toHaveBeenCalled()
    const transcripts = screen.getAllByRole('document', {
      name: 'Accessible unified diff',
    })
    expect(transcripts).toHaveLength(2)
    expect(
      within(transcripts[0]!).getByRole('heading', {
        level: 4,
        name: 'Hunk. Old line 1. New line 1.',
      }),
    ).toBeTruthy()
    expect(transcripts[0]?.textContent).toContain(
      'Deleted. Old line 1. New line not applicable. const firstValue: boolean = false',
    )
    expect(transcripts[0]?.textContent).toContain(
      'Added. Old line not applicable. New line 1. const firstValue: boolean = true',
    )
    expect(transcripts[0]?.querySelector('[tabindex]')).toBeNull()
    expect(diffHosts[0]?.parentElement?.getAttribute('aria-hidden')).toBe(
      'true',
    )

    const treeHost = await waitFor(() => {
      const host = container.querySelector('file-tree-container')
      expect(host?.shadowRoot).toBeTruthy()
      return host!
    })
    const secondTreeItem = await waitFor(() => {
      const item = treeHost.shadowRoot?.querySelector<HTMLElement>(
        '[data-item-path="src/second.ts"]',
      )
      expect(item).toBeTruthy()
      return item!
    })

    expect(
      treeHost.shadowRoot
        ?.querySelector(
          '[data-item-path="src/first.ts"] [data-item-section="decoration"] span',
        )
        ?.getAttribute('title'),
    ).toBe('Modified; text content')
    expect(
      screen.getAllByLabelText('File status: Modified; Text'),
    ).toHaveLength(2)

    fireEvent.click(secondTreeItem)

    const secondHeading = screen.getByRole('heading', {
      name: 'src/second.ts',
    })
    await waitFor(() => {
      expect(secondTreeItem.getAttribute('aria-selected')).toBe('true')
      expect(secondHeading).toBe(document.activeElement)
    })
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
    expect(
      screen.getByRole('region', { name: 'Diff for src/second.ts' }),
    ).toBeTruthy()

    const secondFileSection = screen.getByRole('region', {
      name: 'src/second.ts',
    })
    fireEvent.click(
      within(secondFileSection).getByRole('button', {
        name: 'Back to changed files',
      }),
    )
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Changed files' })).toBe(
        document.activeElement,
      )
      expect(secondTreeItem.getAttribute('tabindex')).toBe('0')
    })
  })

  test('restores a bounded file index and persists expanded view-mode changes', async () => {
    const onSelectedFileIndexChange = vi.fn()
    const onViewChange = vi.fn()
    const view = render(
      <CandidateDiffRenderer
        content={content}
        expanded
        projection={projection}
        selectedFileIndex={1}
        view="split"
        onSelectedFileIndexChange={onSelectedFileIndexChange}
        onViewChange={onViewChange}
      />,
    )

    expect(
      screen.getByRole('region', { name: 'Diff for src/second.ts' }),
    ).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Diff view' })).toBeTruthy()
    expect(
      screen
        .getByRole('button', { name: 'Split' })
        .getAttribute('data-pressed'),
    ).not.toBeNull()

    const diffHosts = await waitFor(() => {
      const hosts = view.container.querySelectorAll('diffs-container')
      expect(hosts).toHaveLength(2)
      return hosts
    })
    await waitFor(() => {
      for (const host of diffHosts) {
        expect(
          host.shadowRoot?.querySelector('pre')?.getAttribute('data-diff-type'),
        ).toBe('split')
      }
    })
    expect(
      screen.getAllByRole('document', { name: 'Accessible split diff' }),
    ).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Unified' }))
    expect(onViewChange).toHaveBeenCalledWith('unified')

    const treeHost = await waitFor(() => {
      const host = view.container.querySelector('file-tree-container')
      expect(host?.shadowRoot).toBeTruthy()
      return host!
    })
    const firstTreeItem = treeHost.shadowRoot?.querySelector<HTMLElement>(
      '[data-item-path="src/first.ts"]',
    )
    expect(firstTreeItem).toBeTruthy()
    fireEvent.click(firstTreeItem!)
    expect(onSelectedFileIndexChange).toHaveBeenCalledWith(0)
  })

  test('keeps the tree and diff renderer aligned with the app color scheme', async () => {
    document.documentElement.classList.add('dark')
    const { container } = render(
      <CandidateDiffRenderer content={content} projection={projection} />,
    )

    const treeHost = await waitFor(() => {
      const host = container.querySelector<HTMLElement>('file-tree-container')
      expect(host).toBeTruthy()
      return host!
    })
    expect(treeHost.style.colorScheme).toBe('dark')
    expect(treeHost.style.getPropertyValue('--trees-bg-override')).toBe(
      'var(--background)',
    )
    expect(treeHost.style.getPropertyValue('--trees-fg-override')).toBe(
      'var(--foreground)',
    )

    const diffHosts = await waitFor(() => {
      const hosts = container.querySelectorAll('diffs-container')
      expect(hosts).toHaveLength(2)
      return hosts
    })
    await waitFor(() => {
      for (const host of diffHosts) {
        expect(host.shadowRoot?.textContent).toContain('const')
      }
    })

    document.documentElement.classList.replace('dark', 'light')
    await waitFor(() => {
      expect(treeHost.style.colorScheme).toBe('light')
    })
  })

  test('uses a mobile changed-files sheet and retains the selected filename in the diff toolbar', async () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })
    const { container } = render(
      <CandidateDiffRenderer content={content} projection={projection} />,
    )

    const filesButton = screen.getByRole('button', {
      name: 'Browse 2 changed files',
    })
    expect(screen.getByTitle('src/first.ts')).toBeTruthy()

    fireEvent.click(filesButton)
    expect(
      await screen.findByRole('dialog', { name: 'Changed files' }),
    ).toBeTruthy()
    const treeHosts = await waitFor(() => {
      const hosts = container.ownerDocument.querySelectorAll(
        'file-tree-container',
      )
      expect(hosts).toHaveLength(2)
      return hosts
    })
    const mobileTreeHost = treeHosts[1]!
    const secondTreeItem = await waitFor(() => {
      const item = mobileTreeHost.shadowRoot?.querySelector<HTMLElement>(
        '[data-item-path="src/second.ts"]',
      )
      expect(item).toBeTruthy()
      return item!
    })

    fireEvent.click(secondTreeItem)

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Changed files' })).toBeNull()
      expect(screen.getByTitle('src/second.ts')).toBeTruthy()
      expect(screen.getByRole('heading', { name: 'src/second.ts' })).toBe(
        document.activeElement,
      )
    })
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })

    fireEvent.click(filesButton)
    expect(
      await screen.findByRole('dialog', { name: 'Changed files' }),
    ).toBeTruthy()
    const reopenedTreeHosts = await waitFor(() => {
      const hosts = container.ownerDocument.querySelectorAll(
        'file-tree-container',
      )
      expect(hosts).toHaveLength(2)
      return hosts
    })
    const selectedSecondTreeItem = await waitFor(() => {
      const item = reopenedTreeHosts[1]?.shadowRoot?.querySelector<HTMLElement>(
        '[data-item-path="src/second.ts"]',
      )
      expect(item).toBeTruthy()
      return item!
    })

    fireEvent.click(selectedSecondTreeItem)

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Changed files' })).toBeNull()
      expect(screen.getByRole('heading', { name: 'src/second.ts' })).toBe(
        document.activeElement,
      )
    })
  })

  test('supports the complete tree key map and announces expansion and file context', async () => {
    const { container } = render(
      <CandidateChangedFilesNavigator
        files={projection.files}
        selectedPath={projection.files[0].path}
        onSelectPath={vi.fn()}
      />,
    )

    const treeHost = await waitFor(() => {
      const host = container.querySelector('file-tree-container')
      expect(host?.shadowRoot).toBeTruthy()
      return host!
    })
    const item = (path: string) =>
      treeHost.shadowRoot?.querySelector<HTMLElement>(
        `[role="treeitem"][data-item-path="${path}"]`,
      )
    const folder = await waitFor(() => {
      const node = item('src/')
      expect(node).toBeTruthy()
      return node!
    })
    const firstFile = item('src/first.ts')!
    const secondFile = item('src/second.ts')!

    await waitFor(() => {
      expect(firstFile.getAttribute('aria-label')).toBe('first.ts')
      expect(folder.getAttribute('aria-label')).toBe('src')
    })
    expect(treeHost.getAttribute('aria-describedby')).toBeTruthy()
    expect(screen.getByText(/Candidate diff only/)).toBeTruthy()
    expect(
      treeHost.shadowRoot?.querySelectorAll('[role="treeitem"][tabindex="0"]'),
    ).toHaveLength(1)
    expect(folder.getAttribute('aria-expanded')).toBe('true')

    folder.focus()
    fireEvent.keyDown(folder, { key: 'ArrowRight' })
    await waitFor(() => {
      expect(treeHost.shadowRoot?.activeElement).toBe(firstFile)
    })

    fireEvent.keyDown(firstFile, { key: 'ArrowDown' })
    await waitFor(() => {
      expect(treeHost.shadowRoot?.activeElement).toBe(secondFile)
    })

    fireEvent.keyDown(secondFile, { key: 'Home' })
    await waitFor(() => {
      expect(treeHost.shadowRoot?.activeElement).toBe(folder)
    })

    fireEvent.keyDown(folder, { key: 'End' })
    await waitFor(() => {
      expect(treeHost.shadowRoot?.activeElement).toBe(secondFile)
    })

    fireEvent.keyDown(secondFile, { key: 'ArrowLeft' })
    await waitFor(() => {
      expect(treeHost.shadowRoot?.activeElement).toBe(folder)
    })
    fireEvent.keyDown(folder, { key: 'ArrowLeft' })
    await waitFor(() => {
      expect(folder.getAttribute('aria-expanded')).toBe('false')
      expect(treeHost.shadowRoot?.activeElement).toBe(folder)
      expect(item('src/first.ts')).toBeNull()
    })

    fireEvent.keyDown(folder, { key: 'ArrowRight' })
    await waitFor(() => {
      expect(folder.getAttribute('aria-expanded')).toBe('true')
      expect(item('src/first.ts')).toBeTruthy()
      expect(treeHost.shadowRoot?.activeElement).toBe(folder)
    })
  })

  test('exposes the beta search surface and filters candidate paths', async () => {
    const { container } = render(
      <CandidateChangedFilesNavigator
        files={projection.files}
        selectedPath={projection.files[0].path}
        onSelectPath={vi.fn()}
      />,
    )
    const treeHost = await waitFor(() => {
      const host = container.querySelector('file-tree-container')
      expect(host?.shadowRoot).toBeTruthy()
      return host!
    })
    const search = await waitFor(() => {
      const input = treeHost.shadowRoot?.querySelector<HTMLInputElement>(
        '[data-file-tree-search-input]',
      )
      expect(input).toBeTruthy()
      return input!
    })

    fireEvent.input(search, { target: { value: 'second' } })

    await waitFor(() => {
      expect(
        treeHost.shadowRoot?.querySelector(
          '[role="treeitem"][data-item-path="src/second.ts"]',
        ),
      ).toBeTruthy()
      expect(
        treeHost.shadowRoot?.querySelector(
          '[role="treeitem"][data-item-path="src/first.ts"]',
        ),
      ).toBeNull()
      expect(screen.getByRole('status').textContent).toContain(
        '1 changed-file match for second',
      )
    })
  })

  test('shows every changed-file and content state as text in the Pierre tree', async () => {
    const files = candidateFiles([
      {
        path: 'src/added.ts',
        changeKind: 'added' as const,
        contentKind: 'text' as const,
      },
      {
        path: 'src/modified.bin',
        changeKind: 'modified' as const,
        contentKind: 'binary' as const,
      },
      {
        path: 'src/deleted-submodule',
        changeKind: 'deleted' as const,
        contentKind: 'submodule' as const,
      },
      {
        path: 'src/renamed.ts',
        previousPath: 'src/old.ts',
        changeKind: 'renamed' as const,
        contentKind: 'unknown' as const,
      },
      {
        path: 'src/copied.ts',
        previousPath: 'src/source.ts',
        changeKind: 'copied' as const,
        contentKind: 'text' as const,
      },
      {
        path: 'src/executable.sh',
        changeKind: 'type-changed' as const,
        contentKind: 'binary' as const,
      },
      {
        path: 'src/conflict.ts',
        changeKind: 'unmerged' as const,
        contentKind: 'unknown' as const,
      },
    ])
    const { container } = render(
      <CandidateChangedFilesNavigator
        files={files}
        selectedPath={files[0].path}
        onSelectPath={vi.fn()}
      />,
    )

    const treeHost = await waitFor(() => {
      const host = container.querySelector('file-tree-container')
      expect(host?.shadowRoot).toBeTruthy()
      return host!
    })
    await waitFor(() => {
      const nodes = treeHost.shadowRoot?.querySelectorAll(
        '[data-item-type="file"] [data-item-section="decoration"] span',
      )
      expect(nodes).toHaveLength(files.length)
    })

    for (const [path, marker, title, gitTitle] of [
      ['src/added.ts', 'Added', 'Added; text content', 'added'],
      [
        'src/modified.bin',
        'Modified · Binary',
        'Modified; binary content',
        'modified',
      ],
      ['src/deleted-submodule', 'Deleted · Submodule', 'Deleted; submodule'],
      ['src/renamed.ts', 'Renamed · ?', 'Renamed; unknown content', 'renamed'],
      ['src/copied.ts', 'Copied', 'Copied; text content', 'added'],
      [
        'src/executable.sh',
        'Type changed · Binary',
        'Type changed; binary content',
        'modified',
      ],
      [
        'src/conflict.ts',
        'Unmerged · ?',
        'Unmerged; unknown content',
        'modified',
      ],
    ] as const) {
      const decoration = treeHost.shadowRoot?.querySelector(
        `[data-item-path="${path}"] [data-item-section="decoration"] span`,
      )
      expect(decoration?.textContent).toBe(marker)
      expect(decoration?.getAttribute('title')).toBe(title)
      const gitDecoration = treeHost.shadowRoot?.querySelector(
        `[data-item-path="${path}"] [data-item-section="git"] span`,
      )
      expect(gitDecoration?.getAttribute('title')).toContain(
        gitTitle ?? 'deleted',
      )
    }
  })

  test('aggregates changed descendants without presenting a repository tree', async () => {
    const files = candidateFiles([
      {
        path: 'README.md',
        changeKind: 'modified' as const,
        contentKind: 'text' as const,
      },
      {
        path: 'src/index.ts',
        changeKind: 'modified' as const,
        contentKind: 'text' as const,
      },
      {
        path: 'src/components/button.tsx',
        changeKind: 'added' as const,
        contentKind: 'text' as const,
      },
      {
        path: 'src/components/input.tsx',
        changeKind: 'deleted' as const,
        contentKind: 'text' as const,
      },
    ])
    const { container } = render(
      <CandidateChangedFilesNavigator
        files={files}
        selectedPath={files[0].path}
        onSelectPath={vi.fn()}
      />,
    )

    const treeHost = await waitFor(() => {
      const host = container.querySelector('file-tree-container')
      expect(host?.shadowRoot).toBeTruthy()
      return host!
    })
    await waitFor(() => {
      expect([
        ...new Set(
          [
            ...(treeHost.shadowRoot?.querySelectorAll(
              '[data-item-type="folder"]',
            ) ?? []),
          ].map((node) => node.getAttribute('data-item-path')),
        ),
      ]).toEqual(['src/', 'src/components/'])
    })

    for (const [path, count, title] of [
      [
        'src/',
        '3 changed',
        'Candidate diff includes 3 changed files under src; full repository contents are not shown',
      ],
      [
        'src/components/',
        '2 changed',
        'Candidate diff includes 2 changed files under src/components; full repository contents are not shown',
      ],
    ] as const) {
      const decoration = await waitFor(() => {
        const node = treeHost.shadowRoot?.querySelector(
          `[data-item-path="${path}"] [data-item-section="decoration"] span`,
        )
        expect(node).toBeTruthy()
        return node!
      })
      expect(decoration.textContent).toBe(count)
      expect(decoration.getAttribute('title')).toBe(title)
    }
  })

  test('labels incomplete changed-file projections without color alone', async () => {
    render(
      <CandidateDiffRenderer
        content={content}
        projection={{ ...projection, artifactTruncated: true }}
      />,
    )

    expect(screen.getByText('Partial changed files')).toBeTruthy()
    expect(screen.getByText('Partial')).toBeTruthy()
    expect(
      screen.getByText('Candidate diff only—not the full repository.'),
    ).toBeTruthy()
    expect(screen.getByText('Changed-file list is partial')).toBeTruthy()
    expect(screen.getByText(/the artifact preview is partial/)).toBeTruthy()
    expect(
      screen.getByText(
        /Do not treat this changed-file list as the complete patch/,
      ),
    ).toBeTruthy()
  })

  test('keeps binary-only candidates navigable without claiming a textual diff', async () => {
    const binaryContent = `diff --git a/image.png b/image.png
new file mode 100644
GIT binary patch
literal 1
`
    const binaryProjection = {
      ...projection,
      files: candidateFiles([
        {
          path: 'image.png',
          changeKind: 'added' as const,
          contentKind: 'binary' as const,
        },
      ]),
    }
    const { container } = render(
      <CandidateDiffRenderer
        content={binaryContent}
        projection={binaryProjection}
      />,
    )

    expect(
      await screen.findByRole('navigation', { name: 'Changed files' }),
    ).toBeTruthy()
    expect(screen.getByText('No textual hunk for this file')).toBeTruthy()
    expect(
      screen.getByText(
        /Binary content has no trustworthy line-by-line preview/,
      ),
    ).toBeTruthy()
    expect(container.querySelector('diffs-container')).toBeNull()
  })

  test('represents metadata-only records without inventing textual changes', async () => {
    const modeOnlyContent = `diff --git a/script.sh b/script.sh
old mode 100644
new mode 100755
`
    render(
      <CandidateDiffRenderer
        content={modeOnlyContent}
        projection={{
          ...projection,
          files: candidateFiles([
            {
              path: 'script.sh',
              changeKind: 'type-changed',
              contentKind: 'unknown',
              oldMode: '100644',
              newMode: '100755',
            },
          ]),
        }}
      />,
    )

    expect(
      await screen.findByText('No textual hunk for this file'),
    ).toBeTruthy()
    expect(
      screen.getByText(/metadata changes without a supported textual hunk/),
    ).toBeTruthy()
  })

  test('explains unsupported records and incomplete parsing', () => {
    render(
      <CandidateDiffRenderer
        content={content}
        projection={{
          ...projection,
          parseComplete: false,
          unsupportedRecords: 2,
        }}
      />,
    )

    expect(screen.getByText('Changed-file list is partial')).toBeTruthy()
    expect(
      screen.getByText(
        /changed-file parsing did not complete and 2 malformed or unsupported records were excluded/,
      ),
    ).toBeTruthy()
    expect(
      screen.getByText(/Only 2 safely parsed paths are shown/),
    ).toBeTruthy()
  })

  test('fails closed when malformed paths leave no safe navigation projection', () => {
    const malformedContent = `diff --cc ../secrets.txt
index 1111111,2222222..3333333
`
    render(
      <CandidateDiffRenderer
        content={malformedContent}
        projection={{
          files: [],
          artifactTruncated: false,
          parseComplete: false,
          unsupportedRecords: 1,
        }}
      />,
    )

    expect(screen.getByText('Changed-file navigation unavailable')).toBeTruthy()
    expect(
      screen.getByText(/1 malformed or unsupported record was excluded/),
    ).toBeTruthy()
    expect(
      screen.getByText(/No candidate path is presented as safe to navigate/),
    ).toBeTruthy()
    expect(screen.queryByRole('tree')).toBeNull()
    expect(screen.getByText(/diff --cc \.\.\/secrets\.txt/)).toBeTruthy()
  })

  test('projects hunk ranges and line kinds in screen-reader reading order', () => {
    const hunks =
      projectAccessibleDiffHunks(`diff --git a/src/example.ts b/src/example.ts
--- a/src/example.ts
+++ b/src/example.ts
@@ -10,3 +20,4 @@ function example() {
 const retained = true
-const removed = true
+const added = true
+const another = true
\\ No newline at end of file
`)

    expect(hunks).toEqual([
      {
        heading:
          'Hunk. Old lines 10 through 12. New lines 20 through 23. Context: function example() {.',
        lines: [
          'Unchanged. Old line 10. New line 20. const retained = true',
          'Deleted. Old line 11. New line not applicable. const removed = true',
          'Added. Old line not applicable. New line 21. const added = true',
          'Added. Old line not applicable. New line 22. const another = true',
          'Note. No newline at end of file.',
        ],
      },
    ])

    expect(
      projectAccessibleDiffHunks(
        `@@ -1 +1 @@
-const removed = true
+const added = true
`,
        'de',
      ),
    ).toEqual([
      {
        heading: 'Änderungsblock. Alte Zeile 1. Neue Zeile 1.',
        lines: [
          'Gelöscht. Alte Zeile 1. Neue Zeile nicht zutreffend. const removed = true',
          'Hinzugefügt. Alte Zeile nicht zutreffend. Neue Zeile 1. const added = true',
        ],
      },
    ])
  })
})
