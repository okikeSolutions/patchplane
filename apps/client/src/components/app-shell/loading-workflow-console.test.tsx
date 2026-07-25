// @vitest-environment jsdom

import {
  cleanup,
  render,
  screen,
} from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { LoadingWorkflowConsole } from './loading-workflow-console'

vi.mock('convex/react', () => ({
  useQuery: () => undefined,
  usePaginatedQuery: () => ({
    results: [],
    status: 'Exhausted',
    loadMore: () => undefined,
  }),
}))

describe('LoadingWorkflowConsole', () => {
  afterEach(() => {
    cleanup()
  })

  test('uses a non-interactive workflow loading skeleton', () => {
    render(<LoadingWorkflowConsole />)

    expect(screen.getByLabelText('Loading workflows').getAttribute('aria-busy')).toBe('true')
    expect(screen.getByText('Loading workflow queue and report status.')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
