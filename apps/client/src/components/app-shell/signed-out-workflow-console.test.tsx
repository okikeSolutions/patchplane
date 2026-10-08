// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { SignedOutWorkflowConsole } from './signed-out-workflow-console'

describe('SignedOutWorkflowConsole', () => {
  afterEach(() => {
    cleanup()
  })

  test('offers a sign-in route back to the localized workflow queue', () => {
    render(<SignedOutWorkflowConsole />)

    expect(
      screen.getByRole('heading', { name: 'Sign in to view workflows' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Sign in' }).getAttribute('href'),
    ).toBe('/api/auth/sign-in?returnPathname=%2Fen%2Fapp')
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  })
})
