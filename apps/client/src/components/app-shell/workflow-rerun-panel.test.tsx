// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { WorkflowRerunPanel } from './workflow-rerun-panel'

const rerunWorkflow = vi.hoisted(() => vi.fn())

vi.mock('@/lib/rerun-workflow', () => ({
  rerunWorkflowServerFn: rerunWorkflow,
}))

describe('WorkflowRerunPanel', () => {
  afterEach(() => {
    cleanup()
    rerunWorkflow.mockReset()
  })

  test('requires a reason, creates a child attempt, and opens it through the route callback', async () => {
    rerunWorkflow.mockResolvedValue({
      ok: true,
      workflowRunId: 'workflow-child',
      sandboxExecutionId: 'execution-child',
    })
    const onCreated = vi.fn()
    render(<WorkflowRerunPanel parentWorkflowRunId="workflow-parent" onCreated={onCreated} />)

    fireEvent.click(screen.getByRole('button', { name: 'Request another run' }))
    const runAgain = screen.getByRole('button', { name: 'Run again' })
    expect(runAgain).toHaveProperty('disabled', true)

    fireEvent.change(screen.getByLabelText('Required reason'), {
      target: { value: 'Retry against the corrected test configuration.' },
    })
    fireEvent.click(runAgain)

    await waitFor(() => expect(rerunWorkflow).toHaveBeenCalledTimes(1))
    expect(rerunWorkflow).toHaveBeenCalledWith({
      data: {
        parentWorkflowRunId: 'workflow-parent',
        reason: 'Retry against the corrected test configuration.',
        idempotencyKey: expect.stringMatching(/^workflow-parent:rerun:/),
      },
    })
    expect(onCreated).toHaveBeenCalledWith('workflow-child')
    expect(screen.getByRole('link', { name: 'Open child run' }).getAttribute('href')).toBe(
      '/app/workflows/workflow-child',
    )
  })

  test('links the durable child and surfaces an unconfirmed dispatch', async () => {
    rerunWorkflow.mockResolvedValue({
      ok: true,
      workflowRunId: 'workflow-child',
      dispatchError: 'The child attempt was created, but execution dispatch could not be confirmed.',
    })
    const onCreated = vi.fn()
    render(<WorkflowRerunPanel parentWorkflowRunId="workflow-parent" onCreated={onCreated} />)

    fireEvent.click(screen.getByRole('button', { name: 'Request another run' }))
    fireEvent.change(screen.getByLabelText('Required reason'), { target: { value: 'Retry safely.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run again' }))

    expect(await screen.findByText(/execution dispatch could not be confirmed/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open child run' }).getAttribute('href')).toBe('/app/workflows/workflow-child')
    expect(onCreated).not.toHaveBeenCalled()
  })

  test('explains when the parent projection is not eligible', () => {
    render(
      <WorkflowRerunPanel
        parentWorkflowRunId="workflow-parent"
        unavailableReason="Wait for this attempt to reach review before requesting another run."
      />,
    )

    expect(screen.getByRole('button', { name: 'Request another run' })).toHaveProperty('disabled', true)
    expect(screen.getByText(/Wait for this attempt to reach review/)).toBeTruthy()
  })

  test('reuses the idempotency key when retrying the same failed request', async () => {
    rerunWorkflow
      .mockResolvedValueOnce({ ok: false, error: 'Dispatch failed' })
      .mockResolvedValueOnce({ ok: true, workflowRunId: 'workflow-child' })
    render(<WorkflowRerunPanel parentWorkflowRunId="workflow-parent" />)

    fireEvent.click(screen.getByRole('button', { name: 'Request another run' }))
    fireEvent.change(screen.getByLabelText('Required reason'), {
      target: { value: 'Retry dispatch.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Run again' }))
    await screen.findByText('Dispatch failed')
    fireEvent.click(screen.getByRole('button', { name: 'Run again' }))

    await waitFor(() => expect(rerunWorkflow).toHaveBeenCalledTimes(2))
    expect(rerunWorkflow.mock.calls[1]?.[0].data.idempotencyKey).toBe(
      rerunWorkflow.mock.calls[0]?.[0].data.idempotencyKey,
    )
  })
})
