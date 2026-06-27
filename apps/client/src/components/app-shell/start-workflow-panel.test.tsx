// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { StartWorkflowPanel } from './start-workflow-panel'

const authState = vi.hoisted(() => ({
  organizationId: 'org_123' as string | undefined,
  user: { email: 'ugo@example.com' } as { readonly email: string } | null,
}))
const startWorkflowServerFn = vi.hoisted(() => vi.fn())

vi.mock('@workos/authkit-tanstack-react-start/client', () => ({
  useAuth: () => authState,
}))

vi.mock('@/lib/start-workflow', () => ({
  startWorkflowServerFn,
}))

vi.mock('@/paraglide/messages', () => ({
  app_workflow_prompt_label: () => 'Prompt',
  app_workflow_prompt_placeholder: () => 'Describe the workflow',
  app_workflow_run_id: () => 'Workflow run',
  app_workflow_run_status: () => 'Workflow status',
  app_workflow_start_button: () => 'Start workflow',
  app_workflow_start_error: () => 'Workflow start failed',
  app_workflow_start_no_org: () => 'Select an organization',
  app_workflow_start_signed_out: () => 'Sign in to start workflow',
  app_workflow_start_submitting: () => 'Starting workflow…',
  app_workflow_start_success: () => 'Workflow started',
  app_workflow_status_detail: () => 'Start a workflow with TanStack Form validation.',
  app_workflow_title: () => 'New workflow',
  app_workflow_prompt_request_id: () => 'Prompt request',
}))

describe('StartWorkflowPanel', () => {
  afterEach(() => {
    cleanup()
    startWorkflowServerFn.mockReset()
    authState.organizationId = 'org_123'
    authState.user = { email: 'ugo@example.com' }
  })

  test('uses Effect Standard Schema validation to block an empty prompt', async () => {
    render(<StartWorkflowPanel />)

    const textarea = screen.getByLabelText('Prompt')
    fireEvent.change(textarea, { target: { value: '' } })
    fireEvent.blur(textarea)
    fireEvent.click(screen.getByRole('button', { name: 'Start workflow' }))

    await waitFor(() => {
      expect(startWorkflowServerFn).not.toHaveBeenCalled()
    })
  })

  test('submits a valid prompt through TanStack Form and renders the workflow result', async () => {
    startWorkflowServerFn.mockResolvedValue({
      ok: true,
      workflowStart: {
        promptRequest: { id: 'prompt_123' },
        workflowRun: { id: 'run_123', status: 'queued' },
      },
    })

    render(<StartWorkflowPanel />)

    const textarea = screen.getByLabelText('Prompt')
    fireEvent.change(textarea, {
      target: { value: 'Review this repo and suggest one safe patch.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start workflow' }))

    await waitFor(() => {
      expect(startWorkflowServerFn).toHaveBeenCalledWith({
        data: { prompt: 'Review this repo and suggest one safe patch.' },
      })
    })

    expect(await screen.findByText('Workflow started')).toBeTruthy()
    expect(screen.getByText('run_123')).toBeTruthy()
  })

  test('keeps submit disabled without an authenticated workspace', () => {
    authState.organizationId = undefined

    render(<StartWorkflowPanel />)

    expect(screen.getByRole('button', { name: 'Start workflow' })).toHaveProperty('disabled', true)
    expect(screen.getByText('Select an organization')).toBeTruthy()
  })
})
