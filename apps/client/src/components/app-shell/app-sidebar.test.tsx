// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from './app-sidebar'

vi.mock('@workos/authkit-tanstack-react-start/client', () => ({
  useAuth: () => ({
    signOut: vi.fn(),
    user: {
      email: 'ugo@example.com',
      firstName: 'Ugo',
    },
  }),
}))

vi.mock('./nav-user', () => ({
  NavUser: () => <div data-testid="nav-user">Logout</div>,
}))

describe('AppSidebar', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        addEventListener: vi.fn(),
        matches: false,
        removeEventListener: vi.fn(),
      })),
    })
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1280,
    })
  })

  afterEach(() => {
    cleanup()
  })

  test('exposes workflow navigation and omits unfinished sections', () => {
    render(
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>,
    )

    expect(screen.getByText('patchplane')).toBeTruthy()
    expect(screen.getByText('Patch reports')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Workflows' }).getAttribute('href'),
    ).toBe('/en/app')
    expect(
      screen
        .getByRole('link', { name: 'Patchplane workflows' })
        .getAttribute('href'),
    ).toBe('/en/app')
    expect(screen.queryByRole('link', { name: 'Reviews' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Sources' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Sandboxes' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Logs' })).toBeNull()
    expect(
      screen.getByRole('link', { name: 'Documentation (opens in a new tab)' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'GitHub (opens in a new tab)' }),
    ).toBeTruthy()
  })
})
