// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SidebarProvider } from '@/components/ui/sidebar'
import { NavUser } from './nav-user'

vi.mock('@/components/locale-switcher', () => ({
  default: () => <button type="button">Language switcher</button>,
}))

vi.mock('@/components/mode-toggle', () => ({
  ModeToggle: () => <button type="button">Theme switcher</button>,
}))

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    })),
  })
})
afterEach(cleanup)

describe('NavUser', () => {
  test('places locale and theme controls together in the sidebar footer', () => {
    render(
      <SidebarProvider>
        <NavUser isSignedIn onSignOut={() => undefined} />
      </SidebarProvider>,
    )

    const controls = screen.getAllByRole('button')
    expect(controls[0]?.textContent).toBe('Language switcher')
    expect(controls[1]?.textContent).toBe('Theme switcher')
  })

  test('renders the localized logout action and signs out when activated', () => {
    const onSignOut = vi.fn()
    render(
      <SidebarProvider>
        <NavUser isSignedIn onSignOut={onSignOut} />
      </SidebarProvider>,
    )

    const logout = screen.getByRole('button', { name: 'Logout' })
    fireEvent.click(logout)

    expect(logout.textContent).toBe('Logout')
    expect(onSignOut).toHaveBeenCalledOnce()
  })
})
