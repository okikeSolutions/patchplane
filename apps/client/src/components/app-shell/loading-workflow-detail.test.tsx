// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { LoadingWorkflowDetail } from './loading-workflow-detail'
import { WorkflowDetailPage } from './workflow-detail-page'

vi.mock('convex/react', () => ({
  useQuery: () => undefined,
}))

describe('LoadingWorkflowDetail', () => {
  afterEach(() => {
    cleanup()
  })

  test.each(['summary', 'changes', 'evidence', 'activity'] as const)(
    'preserves the report shell and selected %s panel geometry',
    (tab) => {
      const { container } = render(<LoadingWorkflowDetail tab={tab} />)

      const status = screen.getByRole('region', {
        name: 'Loading Patch Report',
      })
      expect(status.getAttribute('aria-busy')).toBe('true')
      expect(status.getAttribute('data-loading-tab')).toBe(tab)
      expect(
        screen.getByText(
          'Loading the report header, selected section, and review status.',
        ),
      ).toBeTruthy()
      expect(
        container.querySelector('[data-slot="workflow-report-loading-header"]'),
      ).not.toBeNull()
      expect(
        container.querySelector('[data-slot="workflow-report-loading-tabs"]'),
      ).not.toBeNull()
      expect(
        container.querySelector('[data-slot="workflow-report-loading-panel"]'),
      ).not.toBeNull()
      expect(
        container.querySelector('[data-slot="workflow-report-loading-review"]'),
      ).not.toBeNull()
      expect(screen.queryByRole('button')).toBeNull()
      expect(screen.queryByRole('tab')).toBeNull()
      expect(screen.queryByText('Loading workflows')).toBeNull()
    },
  )

  test('uses the report skeleton while the authenticated detail query resolves', () => {
    render(<WorkflowDetailPage workflowRunId="run-loading" tab="evidence" />)

    expect(
      screen
        .getByRole('region', { name: 'Loading Patch Report' })
        .getAttribute('data-loading-tab'),
    ).toBe('evidence')
  })
})
