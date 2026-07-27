// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import {
  WorkflowRunStatusBadge,
  WorkflowTrustStateBadge,
} from './workflow-status-badge'

describe('workflow status semantic colors', () => {
  afterEach(cleanup)

  test.each([
    ['needs-review', 'Needs review', 'bg-warning/12'],
    ['changes-requested', 'Changes requested', 'bg-warning/12'],
    ['approved', 'Approved', 'bg-success/12'],
    ['rejected', 'Rejected', 'bg-destructive/10'],
  ] as const)('maps %s to its trust-state variant', (state, label, token) => {
    render(<WorkflowTrustStateBadge state={state} />)

    const badge = screen.getByText(label)
    expect(badge.className).toContain(token)
    expect(badge.className).not.toContain('bg-primary')
  })

  test.each([
    ['queued', 'Queued', 'bg-secondary'],
    ['running', 'Running', 'border-border'],
    ['reviewed', 'Run complete', 'bg-success/12'],
    ['failed', 'Execution failed', 'bg-destructive/10'],
  ] as const)(
    'maps %s to its execution-state variant',
    (status, label, token) => {
      render(<WorkflowRunStatusBadge status={status} />)

      expect(screen.getByText(label).className).toContain(token)
    },
  )
})
