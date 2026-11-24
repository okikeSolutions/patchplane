// @vitest-environment happy-dom
import { describe, expect, it } from '@effect/vitest'
import { flushSync } from 'react-dom'
import { ProposalVersion, VerificationAttemptId } from '@patchplane/domain'
import type {
  DiffIslandEvent,
  DiffIslandViewData,
} from './diff-island-contract'
import { mountDiffViewerIsland } from './diff-viewer-island'

const SAMPLE_PATCH = [
  '--- a/src/policy.ts',
  '+++ b/src/policy.ts',
  '@@ -10,2 +10,3 @@',
  ' export const maxWallClock = 30',
  '-export const allowFallback = true',
  '+export const allowFallback = false',
  '+export const strictBoundaries = true',
].join('\n')

const queryButton = (container: Element, selector: string): HTMLElement => {
  const node = container.querySelector(selector)
  expect(node).not.toBeNull()
  if (node instanceof HTMLElement) {
    return node
  }
  throw new Error(`Expected HTMLElement for selector ${selector}`)
}

describe('Isolated React diff viewer island', () => {
  it('mounts cleanly, renders unified diff, emits typed events, handles local collapse state, and unmounts cleanly', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    try {
      const emitted: Array<DiffIslandEvent> = []
      const initialData: DiffIslandViewData = {
        attemptId: VerificationAttemptId.make('att-island-1'),
        proposalVersion: ProposalVersion.make(2),
        diffText: SAMPLE_PATCH,
        focusedFilePath: null,
      }

      const handle = mountDiffViewerIsland(container, initialData, (event) => {
        emitted.push(event)
      })

      const rootEl = container.querySelector(
        '[data-testid="react-diff-island"]',
      )
      expect(rootEl).not.toBeNull()
      expect(rootEl?.getAttribute('data-attempt-id')).toBe('att-island-1')
      expect(rootEl?.getAttribute('data-proposal-version')).toBe('2')

      // Click file header -> emits typed FileFocused event
      const focusBtn = queryButton(
        container,
        '[data-testid="focus-file-src/policy.ts"]',
      )
      focusBtn.click()

      // Click a diff line -> emits typed LineSelected event
      const lineBtn = queryButton(
        container,
        '[data-testid="select-line-src/policy.ts-11"]',
      )
      lineBtn.click()

      expect(emitted).toEqual([
        {
          _tag: 'FileFocused',
          attemptId: 'att-island-1',
          path: 'src/policy.ts',
        },
        {
          _tag: 'LineSelected',
          attemptId: 'att-island-1',
          path: 'src/policy.ts',
          lineNumber: 11,
        },
      ])

      // Local synchronous collapse/expand state stays inside the React island
      const toggleBtn = queryButton(
        container,
        '[data-testid="toggle-file-src/policy.ts"]',
      )
      expect(toggleBtn.textContent).toBe('Collapse')
      flushSync(() => {
        toggleBtn.click()
      })
      expect(toggleBtn.textContent).toBe('Expand')
      expect(
        container.querySelector('[data-testid="diff-hunk-src/policy.ts-0"]'),
      ).toBeNull()

      // Typed prop update refreshes focused state
      handle.update({
        attemptId: initialData.attemptId,
        proposalVersion: initialData.proposalVersion,
        diffText: initialData.diffText,
        focusedFilePath: 'src/policy.ts',
      })
      expect(
        container
          .querySelector('[data-testid="diff-file-src/policy.ts"]')
          ?.getAttribute('data-focused'),
      ).toBe('true')

      // Unmount tears down React root and leaves container empty
      handle.unmount()
      expect(container.innerHTML).toBe('')

      // Subsequent update/unmount calls after unmount are safe no-ops
      handle.update(initialData)
      handle.unmount()
      expect(container.innerHTML).toBe('')
    } finally {
      container.remove()
    }
  })

  it('renders empty state when diff text has no patches', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    try {
      const handle = mountDiffViewerIsland(
        container,
        {
          attemptId: VerificationAttemptId.make('att-empty-1'),
          proposalVersion: ProposalVersion.make(1),
          diffText: '',
          focusedFilePath: null,
        },
        () => {},
      )

      expect(
        container.querySelector('[data-testid="diff-empty"]')?.textContent,
      ).toContain('No diff hunks available')

      handle.unmount()
      expect(container.innerHTML).toBe('')
    } finally {
      container.remove()
    }
  })
})
