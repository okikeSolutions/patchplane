import { type StructuredPatch, parsePatch } from 'diff'
import { useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import type {
  DiffIslandEvent,
  DiffIslandViewData,
  DiffViewerIslandHandle,
} from './diff-island-contract'

interface DiffViewerWidgetProps {
  readonly data: DiffIslandViewData
  readonly onEvent: (event: DiffIslandEvent) => void
}

type ParseDiffResult =
  | {
      readonly ok: true
      readonly patches: ReadonlyArray<StructuredPatch>
    }
  | {
      readonly ok: false
      readonly message: string
    }

const safeParseDiff = (diffText: string): ParseDiffResult => {
  try {
    const patches = parsePatch(diffText).filter(
      (patch) =>
        patch.hunks.length > 0 ||
        patch.newFileName !== undefined ||
        patch.oldFileName !== undefined,
    )
    return { ok: true, patches }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error && error.message.length > 0
          ? error.message
          : 'Malformed unified diff payload',
    }
  }
}

const normalizeDiffPath = (
  rawNewName: string | undefined,
  rawOldName: string | undefined,
  fallbackIndex: number,
): string => {
  const candidate = rawNewName ?? rawOldName ?? `file-${fallbackIndex + 1}`
  const stripped = candidate.replace(/^[ab]\//, '').trim()
  return stripped.length > 0 ? stripped : `file-${fallbackIndex + 1}`
}

/**
 * Isolated React diff-viewer widget.
 *
 * Strictly constrained per ADR 0009:
 * - Receives typed `DiffIslandViewData` props from Foldkit.
 * - Emits typed `DiffIslandEvent` interactions back to Foldkit.
 * - Holds only local synchronous presentation state (collapsed files).
 * - Performs zero networking, zero Promise orchestration, and zero parallel store state.
 */
export function DiffViewerWidget({ data, onEvent }: DiffViewerWidgetProps) {
  const [collapsedFiles, setCollapsedFiles] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const parsed = safeParseDiff(data.diffText)

  const toggleFileCollapsed = (filePath: string) => {
    setCollapsedFiles((previous) => {
      const next = new Set(previous)
      if (next.has(filePath)) {
        next.delete(filePath)
      } else {
        next.add(filePath)
      }
      return next
    })
  }

  if (!parsed.ok) {
    return (
      <section
        aria-label="Unified diff viewer"
        data-attempt-id={data.attemptId}
        data-proposal-version={String(data.proposalVersion)}
        data-testid="react-diff-island"
      >
        <p data-testid="diff-parse-error" role="alert">
          Unable to parse diff: {parsed.message}
        </p>
      </section>
    )
  }

  const { patches } = parsed

  if (patches.length === 0) {
    return (
      <section
        aria-label="Unified diff viewer"
        data-attempt-id={data.attemptId}
        data-proposal-version={String(data.proposalVersion)}
        data-testid="react-diff-island"
      >
        <p data-testid="diff-empty">
          No diff hunks available for this attempt.
        </p>
      </section>
    )
  }

  return (
    <section
      aria-label="Unified diff viewer"
      data-attempt-id={data.attemptId}
      data-proposal-version={String(data.proposalVersion)}
      data-testid="react-diff-island"
    >
      {patches.map((patch, patchIndex) => {
        const filePath = normalizeDiffPath(
          patch.newFileName,
          patch.oldFileName,
          patchIndex,
        )
        const isCollapsed = collapsedFiles.has(filePath)
        const isFocused = data.focusedFilePath === filePath

        return (
          <article
            data-file-path={filePath}
            data-focused={isFocused ? 'true' : 'false'}
            data-testid={`diff-file-${filePath}`}
            key={`${filePath}-${patchIndex}`}
          >
            <header>
              <button
                data-testid={`focus-file-${filePath}`}
                onClick={() =>
                  onEvent({
                    _tag: 'FileFocused',
                    attemptId: data.attemptId,
                    path: filePath,
                  })
                }
                type="button"
              >
                {filePath}
              </button>
              <button
                aria-expanded={!isCollapsed}
                data-testid={`toggle-file-${filePath}`}
                onClick={() => toggleFileCollapsed(filePath)}
                type="button"
              >
                {isCollapsed ? 'Expand' : 'Collapse'}
              </button>
            </header>

            {!isCollapsed &&
              patch.hunks.map((hunk, hunkIndex) => {
                let currentNewLine = hunk.newStart
                return (
                  <div
                    data-testid={`diff-hunk-${filePath}-${hunkIndex}`}
                    key={`${filePath}-hunk-${hunkIndex}`}
                  >
                    <div>
                      @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},
                      {hunk.newLines} @@
                    </div>
                    <ol>
                      {hunk.lines.map((line, lineIndex) => {
                        const lineNumber =
                          currentNewLine > 0 ? currentNewLine : 1
                        if (!line.startsWith('-')) {
                          currentNewLine += 1
                        }
                        const kind = line.startsWith('+')
                          ? 'addition'
                          : line.startsWith('-')
                            ? 'deletion'
                            : 'context'

                        return (
                          <li
                            data-diff-kind={kind}
                            key={`${filePath}-${hunkIndex}-${lineIndex}`}
                          >
                            <button
                              data-line-number={String(lineNumber)}
                              data-testid={`select-line-${filePath}-${lineNumber}`}
                              onClick={() =>
                                onEvent({
                                  _tag: 'LineSelected',
                                  attemptId: data.attemptId,
                                  path: filePath,
                                  lineNumber,
                                })
                              }
                              type="button"
                            >
                              <code>{line}</code>
                            </button>
                          </li>
                        )
                      })}
                    </ol>
                  </div>
                )
              })}
          </article>
        )
      })}
    </section>
  )
}

/**
 * Mounts the isolated React diff viewer onto a Foldkit-owned DOM element.
 * Callers must pair acquisition with `handle.unmount()` via `Effect.acquireRelease`.
 */
export function mountDiffViewerIsland(
  container: Element,
  initialData: DiffIslandViewData,
  onEvent: (event: DiffIslandEvent) => void,
): DiffViewerIslandHandle {
  const root = createRoot(container)
  let unmounted = false

  const renderData = (viewData: DiffIslandViewData) => {
    if (unmounted) return
    flushSync(() => {
      root.render(<DiffViewerWidget data={viewData} onEvent={onEvent} />)
    })
  }

  renderData(initialData)

  return {
    update: renderData,
    unmount: () => {
      if (unmounted) return
      unmounted = true
      flushSync(() => {
        root.unmount()
      })
    },
  }
}
