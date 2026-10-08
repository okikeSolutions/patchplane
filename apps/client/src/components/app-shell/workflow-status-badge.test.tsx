// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import {
  WorkflowRunStatusBadge,
  WorkflowTrustStateBadge,
} from './workflow-status-badge'

describe('workflow status labels', () => {
  afterEach(cleanup)

  test.each([
    ['needs-review', 'Needs review'],
    ['changes-requested', 'Changes requested'],
    ['approved', 'Approved'],
    ['rejected', 'Rejected'],
  ] as const)('shows the %s trust state as %s', (state, label) => {
    render(<WorkflowTrustStateBadge state={state} />)

    expect(screen.getByText(label)).toBeTruthy()
  })

  test.each([
    ['queued', 'Queued'],
    ['running', 'Running'],
    ['reviewed', 'Run complete'],
    ['failed', 'Execution failed'],
  ] as const)('shows %s execution state as %s', (status, label) => {
    render(<WorkflowRunStatusBadge status={status} />)

    expect(screen.getByText(label)).toBeTruthy()
  })
})
