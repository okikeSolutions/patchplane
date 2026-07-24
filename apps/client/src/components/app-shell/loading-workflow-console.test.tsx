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

  test('uses the workflow console loading shell instead of metric cards', () => {
    render(<LoadingWorkflowConsole />)

    expect(screen.getByRole('heading', { name: 'Workflows' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Workflow queue' })).toBeTruthy()
    expect(screen.getByPlaceholderText('Search workflows, repos, run IDs...')).toBeTruthy()
    expect(screen.queryByText('Open workflows')).toBeNull()
    expect(screen.queryByText('App prompts')).toBeNull()
    expect(screen.queryByText('External intake')).toBeNull()
  })
})
