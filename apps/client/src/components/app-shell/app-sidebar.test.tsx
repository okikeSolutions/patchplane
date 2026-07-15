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

vi.mock('@/paraglide/messages', () => ({
  app_operator_fallback: () => 'Operator',
}))

vi.mock('./nav-user', () => ({
  NavUser: ({ displayName }: { readonly displayName: string }) => (
    <div data-testid="nav-user">{displayName}</div>
  ),
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

  test('uses a flush workflow console shell instead of the inset dashboard frame', () => {
    render(
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>,
    )

    const sidebar = document.querySelector('[data-slot="sidebar"]')
    const sidebarContainer = document.querySelector(
      '[data-slot="sidebar-container"]',
    )

    expect(sidebar?.getAttribute('data-variant')).toBe('sidebar')
    expect(sidebarContainer?.className).toContain('border-sidebar-border/60')
    expect(screen.getByText('patchplane')).toBeTruthy()
    expect(screen.getByText('Workflow review')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Workflows' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Reviews' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Sources' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Sandboxes' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Logs' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Trust model' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Dashboard' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Architecture' })).toBeNull()
  })
})
