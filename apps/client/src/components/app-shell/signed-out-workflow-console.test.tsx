// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { SignedOutWorkflowConsole } from './signed-out-workflow-console'

describe('SignedOutWorkflowConsole', () => {
  afterEach(() => {
    cleanup()
  })

  test('uses the fixed English alpha app language with shared card previews', () => {
    render(<SignedOutWorkflowConsole />)

    expect(
      screen.getByRole('heading', { name: 'Sign in to view workflows' }),
    ).toBeTruthy()
    expect(
      screen.getByText(
        'patchplane keeps workflow evidence, sandbox logs, and review state behind your workspace session.',
      ),
    ).toBeTruthy()
    expect(screen.getByText('Private')).toBeTruthy()
    expect(screen.getByText('Protected')).toBeTruthy()
    expect(screen.getByText('Required')).toBeTruthy()
    expect(document.querySelectorAll('[data-slot="card"]')).toHaveLength(3)
  })
})
