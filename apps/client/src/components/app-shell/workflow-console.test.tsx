// @vitest-environment jsdom

import type { Id } from '@patchplane/backend/convex/_generated/dataModel'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { WorkflowDetail, WorkflowStartRow } from './types'
import { WorkflowConsole } from './workflow-console'
import { WorkflowDetailPage } from './workflow-detail-page'

vi.mock('convex/react', () => ({
  useQuery: () => undefined,
}))

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Test fixtures use stable fake Convex IDs.
const reviewedRunId = 'run_reviewed' as Id<'workflowRuns'>
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Test fixtures use stable fake Convex IDs.
const queuedRunId = 'run_queued' as Id<'workflowRuns'>

function workflowRow(
  id: Id<'workflowRuns'>,
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
  })

  test('renders the workflow queue and inspector around trust-loop evidence', () => {
    const reviewed = workflowRow(
      reviewedRunId,
      'reviewed',
      'PatchPlane smoke retry after GitHub App PEM fix',
    )
    const queued = workflowRow(
      queuedRunId,
      'queued',
      'Review the recent authentication foundation',
    )

    render(
      <WorkflowConsole
        detailOverrides={{ [reviewedRunId]: workflowDetail(reviewed) }}
        metrics={{ appRequests: 1, externalRequests: 1, visibleRequests: 2 }}
        viewer={{ subject: 'user_123', name: 'Ugo' }}
        workflows={[reviewed, queued]}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Workflows' })).toBeTruthy()
    expect(screen.getByPlaceholderText('Search workflows, repos, run IDs...')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Workflow queue' })).toBeTruthy()
    expect(screen.getAllByText('okikeSolutions/guerillaglass').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Sandbox failed').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('failed · exit 1')).toBeTruthy()
    expect(screen.getByText('1 artifact ref')).toBeTruthy()
    expect(screen.getByText('Untrusted')).toBeTruthy()
  })

  test('filters workflow rows by search text and trust-state buttons', () => {
    const reviewed = workflowRow(
      reviewedRunId,
      'reviewed',
      'PatchPlane smoke retry after GitHub App PEM fix',
    )
    const queued = workflowRow(
      queuedRunId,
      'queued',
      'Review the recent authentication foundation',
    )

    render(
      <WorkflowConsole
        detailOverrides={{ [reviewedRunId]: workflowDetail(reviewed) }}
        metrics={{ appRequests: 1, externalRequests: 1, visibleRequests: 2 }}
        viewer={{ subject: 'user_123', name: 'Ugo' }}
        workflows={[reviewed, queued]}
      />,
    )

    const table = screen.getByRole('table')
    expect(within(table).getByText('PatchPlane smoke retry after GitHub App PEM fix')).toBeTruthy()
    expect(within(table).getByText('Review the recent authentication foundation')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('Search workflows, repos, run IDs...'), {
      target: { value: 'authentication' },
    })

    expect(within(table).queryByText('PatchPlane smoke retry after GitHub App PEM fix')).toBeNull()
    expect(within(table).getByText('Review the recent authentication foundation')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('Search workflows, repos, run IDs...'), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Queued' }))

    expect(within(table).queryByText('PatchPlane smoke retry after GitHub App PEM fix')).toBeNull()
    expect(within(table).getByText('Review the recent authentication foundation')).toBeTruthy()
  })

  test('opens workflow preview from the queue row with M9.5 full-page handoff', async () => {
    const reviewed = workflowRow(
      reviewedRunId,
      'reviewed',
      'PatchPlane smoke retry after GitHub App PEM fix',
    )

    render(
      <WorkflowConsole
        detailOverrides={{ [reviewedRunId]: workflowDetail(reviewed) }}
        metrics={{ appRequests: 0, externalRequests: 1, visibleRequests: 1 }}
        viewer={{ subject: 'user_123', name: 'Ugo' }}
        workflows={[reviewed]}
      />,
    )

    const table = screen.getByRole('table')
    const rowPrompt = within(table).getByText('PatchPlane smoke retry after GitHub App PEM fix')
    const row = rowPrompt.closest('tr')

    expect(row).not.toBeNull()
    fireEvent.click(row!)

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeTruthy()
    })

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'PatchPlane smoke retry after GitHub App PEM fix' })).toBeTruthy()
    expect(within(dialog).getByText('okikeSolutions/guerillaglass · Sandbox failed · run_reviewed')).toBeTruthy()

    expect(within(dialog).getByRole('button', { name: 'Open full workflow' }).getAttribute('href')).toBe('/app/workflows/run_reviewed')
    expect(within(dialog).getByRole('tab', { name: 'Overview' })).toBeTruthy()
    expect(within(dialog).getByRole('tab', { name: 'Timeline' })).toBeTruthy()
    expect(within(dialog).getByRole('tab', { name: 'Artifacts' })).toBeTruthy()
    expect(within(dialog).queryByRole('tab', { name: 'Logs' })).toBeNull()

    fireEvent.click(within(dialog).getByRole('tab', { name: 'Artifacts' }))

    expect(await screen.findByText('r2://patchplane-dev-evidence-artifacts/run_reviewed/diff.patch')).toBeTruthy()
  })

  test('renders the full M9.5 workflow investigation page with runtime and review tabs', () => {
    const reviewed = workflowRow(
      reviewedRunId,
      'reviewed',
      'PatchPlane smoke retry after GitHub App PEM fix',
    )

    render(
      <WorkflowDetailPage
        detailOverride={workflowDetail(reviewed)}
        workflowRunId={reviewedRunId}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Patch report: PatchPlane smoke retry after GitHub App PEM fix' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Agent activity' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Logs' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Decision' })).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Agent activity' }))
    expect(screen.getByText('daytona:pi-rpc')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Decision' }))
    expect(screen.getByLabelText('Required comment')).toBeTruthy()
    const approveButton = screen.getByRole('button', { name: 'Approve' })
    expect(approveButton).toBeInstanceOf(HTMLButtonElement)
    if (!(approveButton instanceof HTMLButtonElement)) {
      throw new Error('Approve control should render as a button')
    }
    expect(approveButton.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('Required comment'), {
      target: { value: 'Looks safe enough for dogfooding.' },
    })
    expect(approveButton.disabled).toBe(false)
  })
})
