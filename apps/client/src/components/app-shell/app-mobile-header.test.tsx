// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SidebarProvider } from '@/components/ui/sidebar'
import { AppMobileHeader } from './app-mobile-header'

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ addEventListener: vi.fn(), matches: true, removeEventListener: vi.fn() })) })
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
})
afterEach(cleanup)

describe('AppMobileHeader', () => {
  test('exposes the off-canvas navigation trigger on small screens', () => {
    render(<SidebarProvider><AppMobileHeader title="Patch report" /></SidebarProvider>)
    const trigger = screen.getByRole('button', { name: 'Open navigation' })
    expect(screen.getByText('Patch report')).toBeTruthy()
    fireEvent.click(trigger)
    expect(trigger.getAttribute('data-slot')).toBe('sidebar-trigger')
  })
})
