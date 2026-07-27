import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ProjectCandidateChangedFiles } from '@patchplane/core/diff/project-candidate-changed-files'
import { CandidateDiffRenderer } from '@/components/app-shell/candidate-diff-renderer'
import { diffProjectionRuntime } from '@/effect/diff-runtime'
import fixtureStyles from './fixture.css?inline'

const representativePreviewBytes = 190_000

type FixtureState = {
  readonly bytes: number
  readonly fileCount: number
  readonly paths: readonly string[]
  readonly readyAtMs?: number
  readonly scenario: 'large' | 'standard'
}

declare global {
  interface Window {
    patchplaneDiffFixture?: FixtureState
    patchplaneDiffSelect?: (path: string) => boolean
  }
}

function filePatch(index: number, changedLinePairs: number) {
  const path = `src/features/feature-${String(index).padStart(3, '0')}/module-${String(index).padStart(3, '0')}.ts`
  const lines = [
    `diff --git a/${path} b/${path}`,
    `index ${String(index).padStart(7, '0')}..${String(index + 1).padStart(7, '0')} 100644`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${String(changedLinePairs)} +1,${String(changedLinePairs)} @@`,
  ]
  for (let line = 0; line < changedLinePairs; line += 1) {
    lines.push(
      `-export const value_${String(line)} = "candidate-${String(index)}-before-${String(line)}"`,
      `+export const value_${String(line)} = "candidate-${String(index)}-after-${String(line)}"`,
    )
  }
  return `${lines.join('\n')}\n`
}

function standardDiff() {
  return Array.from({ length: 12 }, (_, index) => filePatch(index, 8)).join('')
}

function cappedLargeDiff() {
  let content = ''
  for (let index = 0; ; index += 1) {
    const nextPatch = filePatch(index, 32)
    const nextBytes = new TextEncoder().encode(content + nextPatch).byteLength
    if (nextBytes > representativePreviewBytes) return content
    content += nextPatch
  }
}

function allOpenRoots(root: Document | ShadowRoot): readonly ShadowRoot[] {
  const roots: ShadowRoot[] = []
  for (const element of root.querySelectorAll('*')) {
    if (element.shadowRoot !== null) {
      roots.push(element.shadowRoot)
      roots.push(...allOpenRoots(element.shadowRoot))
    }
  }
  return roots
}

function selectChangedFile(path: string) {
  const roots = [document, ...allOpenRoots(document)]
  const item = roots
    .flatMap((root) => [
      ...root.querySelectorAll<HTMLElement>('[data-item-path]'),
    ])
    .find((candidate) => candidate.dataset.itemPath === path)
  item?.click()
  return item !== undefined
}

function markReady(state: FixtureState) {
  let stableFrames = 0
  const check = () => {
    const loading =
      document.querySelector('[aria-label="Loading changed files"]') !== null ||
      document.querySelector('[aria-label="Loading unified diff"]') !== null
    const renderedHeadings = new Set(
      [...document.querySelectorAll('h3')].map((heading) =>
        heading.textContent?.trim(),
      ),
    )
    const allFilesRendered = state.paths.every((path) =>
      renderedHeadings.has(path),
    )
    if (!loading && allFilesRendered) {
      stableFrames += 1
    } else {
      stableFrames = 0
    }
    if (stableFrames < 2) {
      window.requestAnimationFrame(check)
      return
    }
    document.documentElement.dataset.benchmarkReady = 'true'
    window.patchplaneDiffFixture = {
      ...state,
      readyAtMs: performance.now(),
    }
  }
  window.requestAnimationFrame(check)
}

const scenario =
  new URLSearchParams(window.location.search).get('scenario') === 'large'
    ? 'large'
    : 'standard'
const content = scenario === 'large' ? cappedLargeDiff() : standardDiff()
const projection = await diffProjectionRuntime.runPromise(
  ProjectCandidateChangedFiles(content),
)
const fixtureState: FixtureState = {
  bytes: new TextEncoder().encode(content).byteLength,
  fileCount: projection.files.length,
  paths: projection.files.map(({ path }) => path),
  scenario,
}
window.patchplaneDiffFixture = fixtureState
window.patchplaneDiffSelect = selectChangedFile

const style = document.createElement('style')
style.textContent = fixtureStyles
document.head.appendChild(style)

const root = document.querySelector('#root')
if (root === null) throw new Error('Diff performance fixture root is missing')

createRoot(root).render(
  <StrictMode>
    <div className="min-h-screen bg-background p-6 text-foreground">
      <CandidateDiffRenderer content={content} projection={projection} />
    </div>
  </StrictMode>,
)
markReady(fixtureState)
