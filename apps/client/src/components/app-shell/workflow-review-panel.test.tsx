// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { WorkflowDetail } from './types'
import { WorkflowDetailOverview } from './workflow-detail-overview'
import { WorkflowReviewPanel } from './workflow-review-panel'

const submitReviewDecision = vi.hoisted(() => vi.fn())

vi.mock('@/lib/review-decision', () => ({
  submitReviewDecisionServerFn: submitReviewDecision,
}))

const workflowRunId = 'workflow-1'

const detail: WorkflowDetail = {
  workflowRun: {
    id: workflowRunId,
    promptRequestId: 'prompt-1',
    workspaceId: 'workos:org-1',
    traceId: 'trace-1',
    status: 'reviewed',
    modelVersion: 'v1',
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
  runtimeEventsTruncated: false,
  runtimeSessions: [],
  runtimeSessionsTruncated: false,
  sandboxExecutions: [
    {
      id: 'execution-1',
      workflowRunId,
      provider: 'daytona',
      sandboxId: 'sandbox-1',
      command: 'bun test',
      runtimeModel: 'gpt-5.5',
      status: 'succeeded',
      exitCode: 0,
      stdout: 'ok',
      startedAt: 2,
      completedAt: 3,
    },
  ],
  sandboxExecutionsTruncated: false,
  evidenceArtifacts: [],
  evidenceArtifactsTruncated: false,
  candidatePatchSets: [
    {
      id: 'candidate-1',
      workflowRunId,
      status: 'captured',
      createdAt: 3,
    },
  ],
  candidatePatchSetsTruncated: false,
  verificationRequirements: [
    {
      id: 'requirement-1',
      workflowRunId,
      key: 'tests',
      label: 'Tests',
      kind: 'test',
      required: true,
      requiredArtifactKinds: ['test-report'],
      source: 'repository-config',
      createdAt: 3,
    },
  ],
  verificationRequirementsTruncated: false,
  verificationResults: [
    {
      id: 'verification-1',
      workflowRunId,
      requirementId: 'requirement-1',
      candidatePatchSetId: 'candidate-1',
      provider: 'daytona',
      platform: 'linux',
      architecture: 'x86_64',
      status: 'passed',
      artifactIds: [],
      producedArtifactKinds: ['test-report'],
      candidateDigestBefore: 'sha256:candidate',
      startedAt: 3,
      completedAt: 4,
      idempotencyKey: 'verification-1',
    },
  ],
  verificationResultsTruncated: false,
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
      verificationResultIds: ['verification-1'],
      missingRequirementIds: [],
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
    ['Approve', 'Confirm approval', 'approved'],
    ['Request changes', 'Confirm request', 'changes-requested'],
    ['Reject', 'Confirm rejection', 'rejected'],
  ] as const)(
    'submits %s with a required comment and idempotency key',
    async (buttonName, confirmationName, status) => {
      submitReviewDecision.mockResolvedValue({
        ok: true,
        decision: { id: 'decision-1', status },
        publications: [],
      })
      render(<WorkflowReviewPanel detail={detail} />)

      expect(screen.queryByLabelText('Required comment')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: buttonName }))
      expect(document.activeElement).toBe(
        screen.getByLabelText('Required comment'),
      )
      const confirmation = screen.getByRole('button', {
        name: confirmationName,
      })
      expect((confirmation as HTMLButtonElement).disabled).toBe(true)
      fireEvent.change(screen.getByLabelText('Required comment'), {
        target: { value: 'Reviewed evidence.' },
      })
      fireEvent.click(confirmation)

      await waitFor(() => expect(submitReviewDecision).toHaveBeenCalledTimes(1))
      expect(await screen.findByText('Decision recorded')).toBeTruthy()
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

  test('summarizes execution identity and discloses the command only on request', () => {
    const secret = 'runtime-secret-value'
    render(
      <WorkflowReviewPanel
        detail={{
          ...detail,
          sandboxExecutions: detail.sandboxExecutions.map((execution) => ({
            ...execution,
            command: 'TOKEN=[redacted] bun test',
          })),
        }}
      />,
    )

    expect(
      screen.getByText(
        'Provider daytona · Model gpt-5.5 · Duration 0s · Exit 0',
      ),
    ).toBeTruthy()
    expect(screen.getByText('Candidate candidate-1')).toBeTruthy()
    expect(screen.queryByText(/bun test/)).toBeNull()
    expect(screen.queryByText(secret)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Technical details' }))
    expect(screen.getByText('TOKEN=[redacted] bun test')).toBeTruthy()
    expect(screen.queryByText(secret)).toBeNull()
  })

  test('does not present unconfigured verification as a clean automated verdict', () => {
    const { container } = render(
      <WorkflowDetailOverview
        detail={{
          ...detail,
          verificationRequirements: [],
          verificationResults: [],
          policyDecisions: detail.policyDecisions.map((decision) => ({
            ...decision,
            status: 'manual-review',
            summary:
              'PatchPlane found no blocking automated findings; human approval is still required.',
            reason: 'review:clean',
            verificationResultIds: [],
            missingRequirementIds: [],
          })),
        }}
      />,
    )

    expect(screen.getByText('Automated review · Completed')).toBeTruthy()
    expect(
      screen.getAllByText('0 blocking review findings.').length,
    ).toBeGreaterThan(0)
    expect(
      screen.getByText('Required verification · Not configured'),
    ).toBeTruthy()
    expect(
      screen.getAllByText(
        'No required verification is configured; approval requires an explicit override.',
      ).length,
    ).toBeGreaterThan(0)
    expect(
      screen.getByText(
        'Human approval is required before this candidate can be trusted.',
      ),
    ).toBeTruthy()
    expect(
      screen.queryByText(/found no blocking automated findings/i),
    ).toBeNull()
    expect(screen.queryByText('review:clean')).toBeNull()
    expect(
      screen.getByRole('region', { name: 'Trust dimensions' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('region', { name: 'Automated verdict' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('region', { name: 'Decision and publication' }),
    ).toBeTruthy()
    expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(1)
    expect(
      screen
        .getByRole('heading', { name: 'Requested change' })
        .closest('[data-slot="card"]'),
    ).not.toBeNull()
    expect(
      screen.getByText('Needs review').closest('[data-slot="alert"]')
        ?.className,
    ).toContain('border-warning/30')
    expect(container.querySelector('.bg-primary\\/15')).toBeNull()
  })

  test('blocks every decision when the report identity is incoherent', () => {
    render(
      <WorkflowReviewPanel
        detail={detail}
        coherence={{
          status: 'blocked',
          issues: ['superseded-attempt'],
        }}
      />,
    )

    expect(
      (screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    expect(
      (
        screen.getByRole('button', {
          name: 'Request changes',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    expect(
      (screen.getByRole('button', { name: 'Reject' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    expect(screen.getByText('Decision unavailable')).toBeTruthy()
  })

  test('requires an explicit reason when approval overrides incomplete verification', async () => {
    submitReviewDecision.mockResolvedValue({
      ok: true,
      decision: { id: 'decision-1', status: 'approved' },
      publications: [],
    })
    render(
      <WorkflowReviewPanel
        detail={{
          ...detail,
          verificationResults: [],
          policyDecisions: detail.policyDecisions.map((decision) => ({
            ...decision,
            verificationResultIds: [],
            missingRequirementIds: ['requirement-1'],
          })),
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    fireEvent.change(screen.getByLabelText('Required comment'), {
      target: { value: 'Reviewed evidence.' },
    })
    const approve = screen.getByRole('button', { name: 'Confirm approval' })
    expect(approve).toHaveProperty('disabled', true)

    fireEvent.change(screen.getByLabelText('Verification override reason'), {
      target: { value: 'Urgent mitigation; manual evidence was reviewed.' },
    })
    fireEvent.click(approve)

    await waitFor(() => expect(submitReviewDecision).toHaveBeenCalledTimes(1))
    expect(submitReviewDecision.mock.calls[0]?.[0].data).toMatchObject({
      status: 'approved',
      verificationOverrideReason:
        'Urgent mitigation; manual evidence was reviewed.',
    })
  })

  test('blocks approval when policy rejects the current projection', () => {
    render(
      <WorkflowReviewPanel
        detail={{
          ...detail,
          policyDecisions: detail.policyDecisions.map((decision) => ({
            ...decision,
            status: 'rejected',
          })),
        }}
      />,
    )

    expect(screen.getByRole('button', { name: 'Approve' })).toHaveProperty(
      'disabled',
      true,
    )
    expect(screen.queryByLabelText('Required comment')).toBeNull()
  })

  test('keeps the rail compact until an action is selected and restores focus on cancel', () => {
    render(<WorkflowReviewPanel detail={detail} />)

    const reject = screen.getByRole('button', { name: 'Reject' })
    expect(screen.queryByLabelText('Required comment')).toBeNull()

    fireEvent.click(reject)
    expect(document.activeElement).toBe(
      screen.getByLabelText('Required comment'),
    )
    expect(
      screen.getByRole('button', { name: 'Confirm rejection' }),
    ).toHaveProperty('disabled', true)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Required comment')).toBeNull()
    expect(document.activeElement).toBe(reject)
  })

  test('fails closed when the verification projection is truncated', () => {
    render(
      <WorkflowReviewPanel
        detail={{
          ...detail,
          verificationResultsTruncated: true,
        }}
      />,
    )

    expect(screen.queryByLabelText('Verification override reason')).toBeNull()
    expect(screen.getByRole('button', { name: 'Approve' })).toHaveProperty(
      'disabled',
      true,
    )
    expect(
      screen.getByText(/Approval is blocked until the complete projection/),
    ).toBeTruthy()
  })

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

    expect(screen.getByRole('button', { name: 'Approve' })).toHaveProperty(
      'disabled',
      true,
    )
  })

  test('invalidates a failed publication retry when a newer projection appears', async () => {
    submitReviewDecision
      .mockResolvedValueOnce({ ok: false, error: 'Publication failed' })
      .mockResolvedValueOnce({
        ok: true,
        decision: { id: 'decision-1', status: 'approved' },
        publications: [],
      })
    const { rerender } = render(<WorkflowReviewPanel detail={detail} />)

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    fireEvent.change(screen.getByLabelText('Required comment'), {
      target: { value: 'Reviewed evidence.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approval' }))
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
          verificationResults: [
            ...detail.verificationResults,
            {
              ...detail.verificationResults[0],
              id: 'verification-2',
              candidatePatchSetId: 'candidate-2',
              startedAt: 20,
              completedAt: 21,
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
              verificationResultIds: ['verification-2'],
              createdAt: 22,
            },
          ],
        }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approval' }))
    await waitFor(() => expect(submitReviewDecision).toHaveBeenCalledTimes(2))

    const firstKey = submitReviewDecision.mock.calls[0]?.[0].data.idempotencyKey
    const secondKey =
      submitReviewDecision.mock.calls[1]?.[0].data.idempotencyKey
    expect(secondKey).not.toBe(firstKey)
    expect(submitReviewDecision.mock.calls[1]?.[0].data).toMatchObject({
      sandboxExecutionId: 'execution-2',
      candidatePatchSetId: 'candidate-2',
      reviewRunId: 'review-2',
      policyDecisionId: 'policy-2',
    })
  })
})
