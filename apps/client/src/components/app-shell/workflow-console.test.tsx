// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { WorkflowDetail, WorkflowStartRow } from './types'
import { WorkflowConsole } from './workflow-console'
import { WorkflowDetailPage } from './workflow-detail-page'

vi.mock('convex/react', () => ({
  useQuery: () => undefined,
  usePaginatedQuery: () => ({
    results: [],
    status: 'Exhausted',
    loadMore: () => undefined,
  }),
}))

const reviewedRunId = 'run_reviewed'
const queuedRunId = 'run_queued'

function workflowRow(
  id: string,
  status: WorkflowStartRow['workflowRun']['status'],
  prompt: string,
): WorkflowStartRow {
  return {
    promptRequest: {
      id: `prompt_${id}`,
      workspaceId: 'workos:org_123',
      actorId: 'github:octocat',
      traceId: `trace_${id}`,
      source: 'external',
      prompt,
      externalRef: {
        provider: 'github',
        deliveryId: `delivery_${id}`,
        eventKind: 'github.issue_comment.created',
        repositoryFullName: 'okikeSolutions/guerillaglass',
        issueNumber: 42,
        senderLogin: 'octocat',
        url: 'https://github.com/okikeSolutions/guerillaglass/issues/42',
      },
      status: 'created',
      createdAt: 1_778_000_000_000,
    },
    workflowRun: {
      id,
      promptRequestId: `prompt_${id}`,
      workspaceId: 'workos:org_123',
      traceId: `trace_${id}`,
      status,
      createdAt: 1_778_000_100_000,
    },
  }
}

function workflowDetail(row: WorkflowStartRow): WorkflowDetail {
  return {
    ...row,
    runtimeEvents: [
      {
        id: 'runtime_event_1',
        workflowRunId: row.workflowRun.id,
        provider: 'pi',
        type: 'agent.patch.generated',
        occurredAt: 1_778_000_200_000,
        summary: 'Patch artifact generated',
        payloadJson: JSON.stringify({
          artifactRefs: ['r2://patchplane-dev-evidence-artifacts/run_reviewed/diff.patch'],
        }),
      },
    ],
    runtimeEventsTruncated: false,
    runtimeSessions: [
      {
        id: 'runtime_session_1',
        workflowRunId: row.workflowRun.id,
        provider: 'daytona:pi-rpc',
        sandboxId: 'sandbox_123',
        sessionId: 'session_123',
        commandId: 'command_123',
        status: 'completed',
        startedAt: 1_778_000_150_000,
        updatedAt: 1_778_000_310_000,
        completedAt: 1_778_000_310_000,
      },
    ],
    evidenceArtifacts: [],
    candidatePatchSets: [
      {
        id: 'candidate_patch_1',
        workflowRunId: row.workflowRun.id,
        status: 'captured',
        createdAt: 1_778_000_310_000,
      },
    ],
    verificationRequirements: [],
    verificationRequirementsTruncated: false,
    verificationResults: [],
    verificationResultsTruncated: false,
    reviewRuns: [
      {
        id: 'review_run_1',
        workflowRunId: row.workflowRun.id,
        sandboxExecutionId: 'sandbox_execution_1',
        candidatePatchSetId: 'candidate_patch_1',
        kind: 'test',
        reviewer: 'patchplane:test-reviewer',
        status: 'completed',
        startedAt: 1_778_000_320_000,
        completedAt: 1_778_000_321_000,
        createdAt: 1_778_000_320_000,
      },
    ],
    reviewFindings: [],
    policyDecisions: [
      {
        id: 'policy_decision_1',
        workflowRunId: row.workflowRun.id,
        reviewRunId: 'review_run_1',
        status: 'changes-requested',
        summary: 'Typecheck must pass before approval.',
        createdAt: 1_778_000_322_000,
      },
    ],
    humanDecisions: [],
    publicationResults: [],
    provenanceEvents: [],
    sandboxExecutions: [
      {
        id: 'sandbox_execution_1',
        workflowRunId: row.workflowRun.id,
        provider: 'daytona',
        sandboxId: 'sandbox_123',
        command: 'bun typecheck',
        status: 'failed',
        exitCode: 1,
        stdout: 'Typecheck failed',
        stderr: 'src/index.ts:1:1 error',
        policy: {
          lifecycle: {
            ephemeral: true,
            retainAfterRun: false,
          },
          network: {
            blockAll: false,
            allowList: 'github.com',
          },
          resources: {},
          timeoutSeconds: 600,
        },
        startedAt: 1_778_000_300_000,
        completedAt: 1_778_000_310_000,
      },
    ],
  }
}

describe('WorkflowConsole', () => {
  afterEach(() => {
    cleanup()
    window.history.replaceState(null, '', '/')
  })

  test('renders a full-width workflow queue with canonical trust state', () => {
    const reviewed = workflowRow(
      reviewedRunId,
      'reviewed',
      'patchplane smoke retry after GitHub App PEM fix',
    )
    const queued = workflowRow(
      queuedRunId,
      'queued',
      'Review the recent authentication foundation',
    )

    render(
      <WorkflowConsole
        metrics={{ appRequests: 1, externalRequests: 1, visibleRequests: 2 }}
        viewer={{ subject: 'user_123', name: 'Ugo' }}
        workflows={[reviewed, queued]}
      />,
    )

    expect(screen.getByText('Workflows')).toBeTruthy()
    expect(screen.getByPlaceholderText('Search workflows, repos, run IDs...')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Workflow queue' })).toBeTruthy()
    expect(screen.getByText(/Workflow runs with execution status/)).toBeTruthy()
    expect(screen.getAllByText('okikeSolutions/guerillaglass').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Needs review').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: /^patchplane smoke retry after GitHub App PEM fix\./ }).className).toContain('min-h-11')
  })

  test('filters workflow rows by search text and trust-state buttons', () => {
    const reviewed = workflowRow(
      reviewedRunId,
      'reviewed',
      'patchplane smoke retry after GitHub App PEM fix',
    )
    const queued = workflowRow(
      queuedRunId,
      'queued',
      'Review the recent authentication foundation',
    )

    render(
      <WorkflowConsole
        metrics={{ appRequests: 1, externalRequests: 1, visibleRequests: 2 }}
        viewer={{ subject: 'user_123', name: 'Ugo' }}
        workflows={[reviewed, queued]}
      />,
    )

    const table = screen.getByRole('table')
    expect(within(table).getByText('patchplane smoke retry after GitHub App PEM fix')).toBeTruthy()
    expect(within(table).getByText('Review the recent authentication foundation')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('Search workflows, repos, run IDs...'), {
      target: { value: 'authentication' },
    })

    expect(within(table).queryByText('patchplane smoke retry after GitHub App PEM fix')).toBeNull()
    expect(within(table).getByText('Review the recent authentication foundation')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('Search workflows, repos, run IDs...'), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Queued' }))

    expect(within(table).queryByText('patchplane smoke retry after GitHub App PEM fix')).toBeNull()
    expect(within(table).getByText('Review the recent authentication foundation')).toBeTruthy()
  })

  test('links queue rows directly to the full workflow page with queue context', () => {
    const reviewed = workflowRow(
      reviewedRunId,
      'reviewed',
      'patchplane smoke retry after GitHub App PEM fix',
    )
    window.history.replaceState(null, '', '/app?filter=needs-review')

    render(
      <WorkflowConsole
        initialSearch={{ filter: 'needs-review', query: '', repository: 'all' }}
        metrics={{ appRequests: 0, externalRequests: 1, visibleRequests: 1 }}
        viewer={{ subject: 'user_123', name: 'Ugo' }}
        workflows={[reviewed]}
      />,
    )

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('link', { name: /^patchplane smoke retry after GitHub App PEM fix\./ }).getAttribute('href')).toBe(
      '/app/workflows/run_reviewed?returnTo=%2Fapp%3Ffilter%3Dneeds-review',
    )
  })

  test('renders the streamlined workflow investigation page with evidence beside decisions', () => {
    const reviewed = workflowRow(
      reviewedRunId,
      'reviewed',
      'patchplane smoke retry after GitHub App PEM fix',
    )

    render(
      <WorkflowDetailPage
        detailOverride={workflowDetail(reviewed)}
        workflowRunId={reviewedRunId}
      />,
    )

    expect(screen.getByRole('heading', { name: 'patchplane smoke retry after GitHub App PEM fix' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Summary' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Changes' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Evidence' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Activity' })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'Logs' })).toBeNull()
    expect(screen.getByLabelText('Required comment')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }))
    expect(screen.getByText('daytona:pi-rpc')).toBeTruthy()
    const approveButton = screen.getByRole('button', { name: 'Approve' })
    expect(approveButton).toBeInstanceOf(HTMLButtonElement)
    if (!(approveButton instanceof HTMLButtonElement)) {
      throw new Error('Approve control should render as a button')
    }
    expect(approveButton.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('Required comment'), {
      target: { value: 'Looks safe enough for dogfooding.' },
    })
    expect(approveButton.disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Request changes' })).toHaveProperty('disabled', false)
  })
})
