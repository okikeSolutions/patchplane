// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import type { Id } from '@patchplane/backend/convex/_generated/dataModel'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { WorkflowDetail } from './types'
import { WorkflowReviewPanel } from './workflow-review-panel'

const submitReviewDecision = vi.hoisted(() => vi.fn())

vi.mock('@/lib/review-decision', () => ({
  submitReviewDecisionServerFn: submitReviewDecision,
}))

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Test fixtures use stable fake Convex IDs.
const workflowRunId = 'workflow-1' as Id<'workflowRuns'>

const detail: WorkflowDetail = {
  workflowRun: {
    id: workflowRunId,
    promptRequestId: 'prompt-1',
    workspaceId: 'workos:org-1',
    traceId: 'trace-1',
    status: 'reviewed',
    createdAt: 1,
  },
  promptRequest: {
    id: 'prompt-1',
    workspaceId: 'workos:org-1',
    actorId: 'workos:user-1',
    traceId: 'trace-1',
    source: 'app',
    prompt: 'Fix the failing test',
    status: 'created',
    createdAt: 1,
  },
  runtimeEvents: [],
  runtimeSessions: [],
  sandboxExecutions: [
    {
      id: 'execution-1',
      workflowRunId,
      provider: 'daytona',
      sandboxId: 'sandbox-1',
      command: 'bun test',
      status: 'succeeded',
      exitCode: 0,
      stdout: 'ok',
      startedAt: 2,
      completedAt: 3,
    },
  ],
  evidenceArtifacts: [],
  candidatePatchSets: [
    {
      id: 'candidate-1',
      workflowRunId,
      status: 'captured',
      createdAt: 3,
    },
  ],
  reviewRuns: [
    {
      id: 'review-1',
      workflowRunId,
      sandboxExecutionId: 'execution-1',
      candidatePatchSetId: 'candidate-1',
      kind: 'test',
      reviewer: 'patchplane:test-reviewer',
      status: 'completed',
      startedAt: 4,
      completedAt: 5,
      createdAt: 4,
    },
  ],
  reviewFindings: [],
  policyDecisions: [
    {
      id: 'policy-1',
      workflowRunId,
      reviewRunId: 'review-1',
      status: 'approved',
      summary: 'Ready for human review.',
      createdAt: 5,
    },
  ],
  humanDecisions: [],
  publicationResults: [],
  provenanceEvents: [],
}

describe('WorkflowReviewPanel', () => {
  afterEach(() => {
    cleanup()
    submitReviewDecision.mockReset()
  })

  test.each([
    ['Approve', 'approved'],
    ['Request changes', 'changes-requested'],
    ['Reject', 'rejected'],
  ] as const)(
    'submits %s with a required comment and idempotency key',
    async (buttonName, status) => {
      submitReviewDecision.mockResolvedValue({
        ok: true,
        decision: { id: 'decision-1', status },
        publications: [],
      })
      render(<WorkflowReviewPanel detail={detail} />)

      const button = screen.getByRole('button', { name: buttonName })
      expect((button as HTMLButtonElement).disabled).toBe(true)
      fireEvent.change(screen.getByLabelText('Required comment'), {
        target: { value: 'Reviewed evidence.' },
      })
      fireEvent.click(button)

      await waitFor(() => expect(submitReviewDecision).toHaveBeenCalledTimes(1))
      expect(submitReviewDecision).toHaveBeenCalledWith({
        data: {
          workflowRunId: 'workflow-1',
          sandboxExecutionId: 'execution-1',
          candidatePatchSetId: 'candidate-1',
          reviewRunId: 'review-1',
          policyDecisionId: 'policy-1',
          status,
          comment: 'Reviewed evidence.',
          idempotencyKey: expect.stringMatching(/^workflow-1:/),
        },
      })
    },
  )

  test('keeps decisions disabled when the displayed review is not linked to the latest candidate', () => {
    render(
      <WorkflowReviewPanel
        detail={{
          ...detail,
          reviewRuns: detail.reviewRuns.map((review) => ({
            ...review,
            candidatePatchSetId: 'candidate-old',
          })),
        }}
      />,
    )

    fireEvent.change(screen.getByLabelText('Required comment'), {
      target: { value: 'Reviewed evidence.' },
    })
    expect(screen.getByRole('button', { name: 'Approve' })).toHaveProperty(
      'disabled',
      true,
    )
  })

  test('reuses the same idempotency key when a failed submission is retried', async () => {
    submitReviewDecision
      .mockResolvedValueOnce({ ok: false, error: 'Publication failed' })
      .mockResolvedValueOnce({
        ok: true,
        decision: { id: 'decision-1', status: 'approved' },
        publications: [],
      })
    const { rerender } = render(<WorkflowReviewPanel detail={detail} />)

    fireEvent.change(screen.getByLabelText('Required comment'), {
      target: { value: 'Reviewed evidence.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await screen.findByText('Publication failed')
    rerender(
      <WorkflowReviewPanel
        detail={{
          ...detail,
          sandboxExecutions: [
            ...detail.sandboxExecutions,
            {
              ...detail.sandboxExecutions[0],
              id: 'execution-2',
              completedAt: 20,
            },
          ],
          candidatePatchSets: [
            ...detail.candidatePatchSets,
            {
              ...detail.candidatePatchSets[0],
              id: 'candidate-2',
              createdAt: 20,
            },
          ],
          reviewRuns: [
            ...detail.reviewRuns,
            {
              ...detail.reviewRuns[0],
              id: 'review-2',
              sandboxExecutionId: 'execution-2',
              candidatePatchSetId: 'candidate-2',
              createdAt: 21,
            },
          ],
          policyDecisions: [
            ...detail.policyDecisions,
            {
              ...detail.policyDecisions[0],
              id: 'policy-2',
              reviewRunId: 'review-2',
              createdAt: 22,
            },
          ],
        }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(submitReviewDecision).toHaveBeenCalledTimes(2))

    const firstKey = submitReviewDecision.mock.calls[0]?.[0].data.idempotencyKey
    const secondKey =
      submitReviewDecision.mock.calls[1]?.[0].data.idempotencyKey
    expect(secondKey).toBe(firstKey)
    expect(submitReviewDecision.mock.calls[1]?.[0].data).toMatchObject({
      sandboxExecutionId: 'execution-1',
      candidatePatchSetId: 'candidate-1',
      reviewRunId: 'review-1',
      policyDecisionId: 'policy-1',
    })
  })
})
