// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Sidebar, SidebarProvider } from '@/components/ui/sidebar'
import { AppShellHeader } from './app-shell-header'

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      addEventListener: vi.fn(),
      matches: true,
      removeEventListener: vi.fn(),
    })),
  })
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: 390,
  })
})
afterEach(cleanup)

describe('AppShellHeader', () => {
  test('exposes the off-canvas navigation trigger on small screens', () => {
    render(
      <SidebarProvider>
        <AppShellHeader
          parent={{ href: '/en/app', label: 'Workflows' }}
          title="Patch Report"
        />
      </SidebarProvider>,
    )
    const trigger = screen.getByRole('button', { name: 'Toggle navigation' })
    const separator = screen.getByRole('separator')
    const breadcrumb = screen.getByRole('navigation', { name: 'breadcrumb' })
    expect(
      within(breadcrumb)
        .getByRole('link', { name: 'Workflows' })
        .getAttribute('href'),
    ).toBe('/en/app')
    expect(
      within(breadcrumb)
        .getByRole('link', { name: 'Patch Report' })
        .getAttribute('aria-current'),
    ).toBe('page')
    expect(trigger.className).toContain('size-11')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(separator.getAttribute('aria-orientation')).toBe('vertical')
    expect(separator.className.split(' ')).toContain('data-vertical:h-4')
    expect(separator.className.split(' ')).toContain('data-vertical:self-auto')
    expect(separator.className).not.toContain('data-[orientation=vertical]')
    fireEvent.click(trigger)
    expect(trigger.getAttribute('data-slot')).toBe('sidebar-trigger')
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
  })

  test('toggles the desktop sidebar between its expanded and icon-only states', () => {
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

    render(
      <SidebarProvider>
        <Sidebar collapsible="icon" />
        <AppShellHeader title="Workflows" />
      </SidebarProvider>,
    )

    const trigger = screen.getByRole('button', { name: 'Toggle navigation' })
    const sidebar = document.querySelector('[data-slot="sidebar"]')
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(sidebar?.getAttribute('data-collapsible')).toBe('')
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(sidebar?.getAttribute('data-collapsible')).toBe('icon')
  })
})
