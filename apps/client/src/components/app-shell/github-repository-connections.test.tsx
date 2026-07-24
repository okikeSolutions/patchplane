// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { GitHubRepositoryConnections } from './github-repository-connections'

const usePaginatedQuery = vi.hoisted(() => vi.fn())

vi.mock('convex/react', () => ({ usePaginatedQuery }))

const repository = {
  id: 'repository-1',
  repositoryFullName: 'patchplane/example',
  status: 'active' as const,
  private: true,
}

describe('GitHubRepositoryConnections', () => {
  afterEach(() => {
    cleanup()
    usePaginatedQuery.mockReset()
  })

  test('shows and links the latest repository verification', () => {
    usePaginatedQuery.mockReturnValue({
      results: [
        {
          repository,
          latestVerification: {
            workflowRunId: 'workflow-123',
            workflowStatus: 'reviewed',
            verificationStatus: 'approved',
            pullRequestNumber: 42,
            createdAt: 1,
            updatedAt: 2,
          },
        },
      ],
      status: 'Exhausted',
      loadMore: vi.fn(),
    })

    render(<GitHubRepositoryConnections workspaceId="workos:org-1" />)

    expect(screen.getByText('patchplane/example')).toBeTruthy()
    expect(
      screen.getByText('Latest verification', { exact: false }),
    ).toBeTruthy()
    expect(screen.getByText('PR #42', { exact: false })).toBeTruthy()
    expect(screen.getByText('Approved')).toBeTruthy()
    const runLink = screen.getByRole('link', { name: 'View run' })
    expect(runLink.getAttribute('href')).toBe('/app/workflows/workflow-123')
    expect(runLink.getAttribute('data-latest-verification-status')).toBe(
      'approved',
    )
  })

  test('shows an explicit empty state when the repository has no workflow', () => {
    usePaginatedQuery.mockReturnValue({
      results: [{ repository }],
      status: 'Exhausted',
      loadMore: vi.fn(),
    })

    render(<GitHubRepositoryConnections workspaceId="workos:org-1" />)

    expect(screen.getByText('No verification run yet')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'View run' })).toBeNull()
  })
})
