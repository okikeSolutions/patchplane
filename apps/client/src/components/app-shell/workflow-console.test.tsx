// @vitest-environment jsdom

import type { ReactNode } from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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

function renderWithQueryClient(ui: ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false } },
        })
      }
    >
      {ui}
    </QueryClientProvider>,
  )
}

function expectAccessibleReportOutline(title: string) {
  const headings = screen.getAllByRole('heading')
  const levelOneHeadings = headings.filter(
    (heading) => heading.tagName === 'H1',
  )

  expect(levelOneHeadings).toHaveLength(1)
  expect(levelOneHeadings[0]?.textContent).toBe(title)

  const levels = headings.map((heading) => Number(heading.tagName.slice(1)))
  expect(levels[0]).toBe(1)
  for (let index = 1; index < levels.length; index += 1) {
    expect(levels[index]).toBeLessThanOrEqual((levels[index - 1] ?? 0) + 1)
  }

  for (const link of screen.getAllByRole('link')) {
    const name =
      link.getAttribute('aria-label')?.trim() ?? link.textContent?.trim()
    expect(name).toBeTruthy()
  }
}

function expectTableRecordBorders(table: HTMLElement) {
  const bodies = Array.from(table.querySelectorAll('tbody'))
  expect(bodies.length).toBeGreaterThan(0)

  for (const body of bodies.slice(0, -1)) {
    expect(body.className.split(' ')).toContain('[&_tr:last-child]:border-b')
  }

  expect(bodies.at(-1)?.className.split(' ')).not.toContain(
    '[&_tr:last-child]:border-b',
  )
}

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
          artifactRefs: [
            'r2://patchplane-dev-evidence-artifacts/run_reviewed/diff.patch',
          ],
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
    vi.unstubAllGlobals()
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
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
    expect(
      screen.getByPlaceholderText('Search workflows, repos, run IDs...'),
    ).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Workflow queue' })).toBeTruthy()
    expect(
      screen.getByText(/Workflow runs with source context, execution status/),
    ).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Execution' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Trust' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Updated' })).toBeTruthy()
    expect(screen.queryByRole('columnheader', { name: 'Source' })).toBeNull()
    expect(
      screen.queryByRole('columnheader', { name: 'Last event' }),
    ).toBeNull()
    expect(
      screen.getAllByText('okikeSolutions/guerillaglass').length,
    ).toBeGreaterThan(0)
    expect(screen.getAllByText('Needs review').length).toBeGreaterThan(0)
    expect(
      screen.getByRole('link', {
        name: /^patchplane smoke retry after GitHub App PEM fix\./,
      }).className,
    ).toContain('min-h-11')
  })

  test('renders only the pull request title in the workflow queue', () => {
    const title = 'feat(agent): make local runs discoverable and verifiable'
    const body = '# Summary\nPersist deterministic project-bound artifacts.'
    const externalReview = 'Greptile review: one blocking finding'
    const reviewed = workflowRow(
      reviewedRunId,
      'reviewed',
      `${title}\n\n${body}\n\n${externalReview}`,
    )
    reviewed.promptRequest.externalRef = {
      ...reviewed.promptRequest.externalRef!,
      eventKind: 'github.pull_request.synchronize',
      issueTitle: title,
      pullRequestNumber: 128,
    }
    reviewed.workflowRun.attemptNumber = 2
    reviewed.workflowRun.updatedAt = reviewed.workflowRun.createdAt + 60_000

    render(
      <WorkflowConsole
        metrics={{ appRequests: 0, externalRequests: 1, visibleRequests: 1 }}
        viewer={{ subject: 'user_123', name: 'Ugo' }}
        workflows={[reviewed]}
      />,
    )

    const titleNode = screen.getByText(title)
    const link = titleNode.closest('a')
    if (link === null) {
      throw new Error('Workflow title is not linked to its report')
    }
    expect(link.getAttribute('aria-label')).not.toContain(body)
    expect(link.getAttribute('aria-label')).not.toContain(externalReview)
    expect(titleNode.className).toContain('truncate')
    expect(titleNode.getAttribute('title')).toBe(title)
    expect(
      screen.getByText('okikeSolutions/guerillaglass · PR #128 · Attempt 2'),
    ).toBeTruthy()
    expect(screen.queryByText(reviewed.workflowRun.id)).toBeNull()
    expect(
      screen.queryByText(/Persist deterministic project-bound artifacts/),
    ).toBeNull()
    expect(screen.queryByText(/Greptile review/)).toBeNull()
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
    expect(
      within(table).getByText(
        'patchplane smoke retry after GitHub App PEM fix',
      ),
    ).toBeTruthy()
    expect(
      within(table).getByText('Review the recent authentication foundation'),
    ).toBeTruthy()

    fireEvent.change(
      screen.getByPlaceholderText('Search workflows, repos, run IDs...'),
      {
        target: { value: 'authentication' },
      },
    )

    expect(
      within(table).queryByText(
        'patchplane smoke retry after GitHub App PEM fix',
      ),
    ).toBeNull()
    expect(
      within(table).getByText('Review the recent authentication foundation'),
    ).toBeTruthy()

    fireEvent.change(
      screen.getByPlaceholderText('Search workflows, repos, run IDs...'),
      {
        target: { value: '' },
      },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Queued' }))

    expect(
      within(table).queryByText(
        'patchplane smoke retry after GitHub App PEM fix',
      ),
    ).toBeNull()
    expect(
      within(table).getByText('Review the recent authentication foundation'),
    ).toBeTruthy()
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
    expect(
      screen
        .getByRole('link', {
          name: /^patchplane smoke retry after GitHub App PEM fix\./,
        })
        .getAttribute('href'),
    ).toBe(
      '/en/app/workflows/run_reviewed?returnTo=%2Fapp%3Ffilter%3Dneeds-review',
    )
  })

  test('renders the streamlined workflow investigation page with evidence beside decisions', async () => {
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

    expect(
      screen.getByRole('heading', {
        name: 'patchplane smoke retry after GitHub App PEM fix',
      }),
    ).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Summary' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Changes' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Evidence' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Activity' })).toBeTruthy()
    const reportTabs = screen.getByRole('tablist', {
      name: 'Patch report sections',
    })
    expect(reportTabs.className).toContain('sticky')
    expect(reportTabs.className).toContain('top-0')
    expect(reportTabs.className).toContain('group-data-horizontal/tabs:h-auto')
    const reportTabsRoot = reportTabs.closest('[data-slot="tabs"]')
    expect(reportTabsRoot).toBeInstanceOf(HTMLDivElement)
    expect(reportTabsRoot?.className).toContain('gap-6')
    for (const tab of ['Summary', 'Changes', 'Evidence', 'Activity']) {
      expect(screen.getByRole('tab', { name: tab }).className).toContain(
        'flex-none',
      )
    }
    const reportContent = document.querySelector(
      '[data-slot="workflow-report-content"]',
    )
    expect(reportContent).toBeInstanceOf(HTMLDivElement)
    expect(reportContent?.className).toContain('pb-10')
    expect(reportContent?.className).toContain('lg:pb-12')
    expect(reportContent?.className).not.toContain('min-h-0')
    expect(screen.queryByRole('tab', { name: 'Logs' })).toBeNull()
    expect(screen.queryByLabelText('Required comment')).toBeNull()
    expect(screen.queryByText('Review ready')).toBeNull()
    expect(screen.queryByText('manual-review')).toBeNull()
    expect(screen.queryByText('No blockers')).toBeNull()
    expect(screen.getAllByText('Sandbox failed').length).toBeGreaterThan(0)
    expect(
      screen.getAllByText('Required verification is not configured.').length,
    ).toBeGreaterThan(0)
    expect(
      screen.getAllByText('Policy status is changes-requested.').length,
    ).toBeGreaterThan(0)

    if (!(reportTabsRoot instanceof HTMLDivElement)) {
      throw new Error('Patch report tabs should render in the shared Tabs root')
    }
    const reviewPane = document.querySelector(
      '[data-slot="workflow-review-pane"]',
    )
    expect(reviewPane).toBeInstanceOf(HTMLElement)
    expect(reviewPane?.className).toContain('self-start')
    expect(reviewPane?.className).toContain('xl:sticky')
    expect(reviewPane?.className).toContain('xl:top-4')
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })

    fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }))
    expect(document.querySelector('[data-slot="workflow-review-pane"]')).toBe(
      reviewPane,
    )
    const evidenceTabs = screen.getByRole('tablist', {
      name: 'Evidence views',
    })
    expect(evidenceTabs.className).toContain('max-w-full')
    expect(evidenceTabs.className).toContain(
      'group-data-horizontal/tabs:h-auto',
    )
    expect(evidenceTabs.className.split(' ')).not.toContain('w-full')
    expect(evidenceTabs.closest('[data-slot="tabs"]')?.className).toContain(
      'gap-5',
    )
    for (const tab of ['Artifacts (0)', 'Sandbox (1)', 'Logs', 'Diagnostics']) {
      expect(screen.getByRole('tab', { name: tab }).className).toContain(
        'flex-none',
      )
    }
    fireEvent.click(screen.getByRole('tab', { name: 'Logs' }))
    const runtimeLogTable = screen.getByRole('table', {
      name: /Normalized runtime events/,
    })
    expect(runtimeLogTable.className).toContain('table-fixed')
    expect(runtimeLogTable.querySelectorAll('col')).toHaveLength(5)
    expect(
      Array.from(runtimeLogTable.querySelectorAll('col')).every(
        (column) => !column.className.includes('hidden'),
      ),
    ).toBe(true)
    expectTableRecordBorders(runtimeLogTable)
    const logTabs = screen.getByRole('tablist', { name: 'Log streams' })
    expect(logTabs.className).toContain('flex-wrap')
    expect(logTabs.className).toContain('max-w-full')
    expect(
      within(runtimeLogTable).getByText('Patch artifact generated'),
    ).toBeTruthy()
    expect(within(runtimeLogTable).queryByText(/payloadJson/)).toBeNull()
    fireEvent.click(
      within(runtimeLogTable).getByRole('button', {
        name: 'Show details for Patch artifact generated',
      }),
    )
    expect(within(runtimeLogTable).getByText(/payloadJson/)).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Stdout (1)' }))
    const stdoutTable = screen.getByRole('table', {
      name: /Sandbox standard output streams/,
    })
    expect(stdoutTable.className).toContain('table-fixed')
    expect(stdoutTable.querySelectorAll('col')).toHaveLength(5)
    expectTableRecordBorders(stdoutTable)
    expect(within(stdoutTable).queryByText('Typecheck failed')).toBeNull()
    fireEvent.click(
      within(stdoutTable).getByRole('button', {
        name: 'Show details for bun typecheck',
      }),
    )
    expect(within(stdoutTable).getByText('Typecheck failed')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Stderr (1)' }))
    const stderrTable = screen.getByRole('table', {
      name: /Sandbox standard error streams/,
    })
    expect(stderrTable.className).toContain('table-fixed')
    expect(stderrTable.querySelectorAll('col')).toHaveLength(5)
    expectTableRecordBorders(stderrTable)
    expect(within(stderrTable).queryByText('src/index.ts:1:1 error')).toBeNull()
    fireEvent.click(
      within(stderrTable).getByRole('button', {
        name: 'Show details for bun typecheck',
      }),
    )
    expect(within(stderrTable).getByText('src/index.ts:1:1 error')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Diagnostics' }))
    const diagnosticsTable = screen.getByRole('table', {
      name: /Normalized workflow diagnostic groups/,
    })
    expect(diagnosticsTable.className).toContain('table-fixed')
    expect(within(diagnosticsTable).queryByText(/workspaceId/)).toBeNull()
    fireEvent.click(
      within(diagnosticsTable).getByRole('button', {
        name: 'Show details for Prompt request',
      }),
    )
    expect(within(diagnosticsTable).getByText(/workspaceId/)).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }))
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(document.querySelector('[data-slot="workflow-review-pane"]')).toBe(
      reviewPane,
    )
    expect(screen.getByText('daytona:pi-rpc')).toBeTruthy()
    const activityTable = screen.getByRole('table', {
      name: /Workflow activity in chronological order/,
    })
    expect(activityTable.className).toContain('table-fixed')
    expect(activityTable.querySelectorAll('col')).toHaveLength(5)
    expect(
      Array.from(activityTable.querySelectorAll('col')).every(
        (column) => !column.className.includes('hidden'),
      ),
    ).toBe(true)
    expectTableRecordBorders(activityTable)
    expect(within(activityTable).getAllByRole('row').length).toBeGreaterThan(2)
    expect(within(activityTable).queryByText('bun typecheck')).toBeNull()
    const sandboxDetails = within(activityTable).getByRole('button', {
      name: 'Show details for Sandbox execution started',
    })
    fireEvent.click(sandboxDetails)
    expect(sandboxDetails.getAttribute('aria-expanded')).toBe('true')
    expect(within(activityTable).getByText('bun typecheck')).toBeTruthy()
    const approveButton = screen.getByRole('button', { name: 'Approve' })
    expect(approveButton).toBeInstanceOf(HTMLButtonElement)
    if (!(approveButton instanceof HTMLButtonElement)) {
      throw new Error('Approve control should render as a button')
    }
    expect(approveButton.disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }))
    expect(document.activeElement).toBe(
      screen.getByLabelText('Required comment'),
    )
    fireEvent.change(screen.getByLabelText('Required comment'), {
      target: { value: 'Looks safe enough for dogfooding.' },
    })
    expect(approveButton.disabled).toBe(true)
    expect(
      screen.getByRole('button', { name: 'Confirm request' }),
    ).toHaveProperty('disabled', false)
  })

  test('renders only the pull request title in the Patch Report header', async () => {
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 0),
    )
    const title = 'feat(agent): make local runs discoverable and verifiable'
    const body = '# Summary\nPersist deterministic project-bound artifacts.'
    const externalReview = 'Greptile review: one blocking finding'
    const reviewed = workflowRow(
      reviewedRunId,
      'reviewed',
      `${title}\n\n${body}\n\n${externalReview}`,
    )
    reviewed.promptRequest.externalRef = {
      ...reviewed.promptRequest.externalRef!,
      eventKind: 'github.pull_request.synchronize',
      issueTitle: title,
      pullRequestNumber: 128,
    }
    reviewed.workflowRun.attemptNumber = 2
    const detail = workflowDetail(reviewed)
    const detailWithStats: WorkflowDetail = {
      ...detail,
      candidatePatchSets: detail.candidatePatchSets.map((candidate, index) => ({
        ...candidate,
        stats:
          index === 0
            ? {
                filesChanged: 3,
                additions: 18,
                deletions: 4,
              }
            : candidate.stats,
      })),
    }

    renderWithQueryClient(
      <WorkflowDetailPage
        detailOverride={detailWithStats}
        workflowRunId={reviewedRunId}
      />,
    )
    const fetchPreview = vi.fn()
    vi.stubGlobal('fetch', fetchPreview)

    const header = screen.getByRole('banner')
    const heading = within(header).getByRole('heading', {
      level: 1,
      name: title,
    })
    expect(heading.textContent).toBe(title)
    expect(heading.className).toContain('line-clamp-2')
    expect(heading.getAttribute('title')).toBe(title)
    expect(header.getAttribute('aria-labelledby')).toBe('patch-report-title')
    expect(within(header).getByText('Workflow run ID:')).toBeTruthy()
    expect(within(header).getByText('Trust status:')).toBeTruthy()
    expect(within(header).queryByText(/Persist deterministic/)).toBeNull()
    expect(within(header).queryByText(/Greptile review/)).toBeNull()
    expect(
      within(header).getByText('okikeSolutions/guerillaglass'),
    ).toBeTruthy()
    expect(within(header).getByText('PR #128')).toBeTruthy()
    expect(within(header).getByText('Attempt 2')).toBeTruthy()
    const changesAction = within(header).getByRole('button', {
      name: 'View Changes: 3 files, 18 additions, 4 deletions',
    })
    expect(changesAction.textContent).toContain('Changes')
    expect(changesAction.textContent).toContain('3 files · +18 · −4')
    expect(
      within(header).getByRole('link', {
        name: 'Open source event on GitHub (opens in a new tab)',
      }),
    ).toBeTruthy()
    const reportTabs = screen.getByRole('tablist', {
      name: 'Patch report sections',
    })
    const requestTrigger = screen.getByRole('button', {
      name: 'Show request',
    })
    expect(requestTrigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText(/Persist deterministic/)).toBeNull()
    fireEvent.click(requestTrigger)
    expect(
      screen
        .getByRole('button', { name: 'Hide request' })
        .getAttribute('aria-expanded'),
    ).toBe('true')
    const requestBody = screen.getByText(/Persist deterministic/)
    expect(
      reportTabs.compareDocumentPosition(requestBody) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    expect(screen.queryByRole('heading', { name: 'Change summary' })).toBeNull()
    expect(fetchPreview).not.toHaveBeenCalled()

    fireEvent.click(changesAction)
    expect(
      screen
        .getByRole('tab', { name: 'Changes' })
        .getAttribute('aria-selected'),
    ).toBe('true')
    expect(
      await screen.findByRole('heading', { name: 'Change summary' }),
    ).toBeTruthy()
    expect(fetchPreview).not.toHaveBeenCalled()
  })

  test('keeps one descriptive h1, logical headings, and named links across report tabs', () => {
    const title = 'feat(agent): make local runs discoverable and verifiable'
    const reviewed = workflowRow(reviewedRunId, 'reviewed', title)
    reviewed.promptRequest.externalRef = {
      ...reviewed.promptRequest.externalRef!,
      eventKind: 'github.pull_request.synchronize',
      issueTitle: title,
      pullRequestNumber: 128,
    }

    renderWithQueryClient(
      <WorkflowDetailPage
        detailOverride={workflowDetail(reviewed)}
        workflowRunId={reviewedRunId}
      />,
    )

    for (const tab of ['Summary', 'Changes', 'Evidence', 'Activity']) {
      fireEvent.click(screen.getByRole('tab', { name: tab }))
      expectAccessibleReportOutline(title)
    }
  })
})
