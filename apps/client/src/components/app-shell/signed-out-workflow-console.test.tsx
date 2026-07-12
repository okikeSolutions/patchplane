// @vitest-environment jsdom

import {
  cleanup,
  render,
  screen,
} from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { SignedOutWorkflowConsole } from './signed-out-workflow-console'

vi.mock('@/paraglide/messages', () => ({
  app_sign_in: () => 'Anmelden',
  app_signed_out_decision_label: () => 'Entscheidung',
  app_signed_out_decision_value: () => 'Erforderlich',
  app_signed_out_evidence_label: () => 'Belege',
  app_signed_out_evidence_value: () => 'Geschuetzt',
  app_signed_out_queue_label: () => 'Queue',
  app_signed_out_queue_value: () => 'Privat',
  app_signed_out_workflows_intro: () =>
    'patchplane schuetzt Workflow-Belege hinter deiner Workspace-Sitzung.',
  app_signed_out_workflows_title: () => 'Anmelden, um Workflows zu sehen',
}))

describe('SignedOutWorkflowConsole', () => {
  afterEach(() => {
    cleanup()
  })

  test('uses localized workflow-console copy with shared card previews', () => {
    render(<SignedOutWorkflowConsole />)

    expect(screen.getByRole('heading', { name: 'Anmelden, um Workflows zu sehen' })).toBeTruthy()
    expect(screen.getByText('patchplane schuetzt Workflow-Belege hinter deiner Workspace-Sitzung.')).toBeTruthy()
    expect(screen.getByText('Privat')).toBeTruthy()
    expect(screen.getByText('Geschuetzt')).toBeTruthy()
    expect(screen.getByText('Erforderlich')).toBeTruthy()
    expect(document.querySelectorAll('[data-slot="card"]')).toHaveLength(3)
  })
})
