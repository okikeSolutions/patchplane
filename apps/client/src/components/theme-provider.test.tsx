// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  createThemeBootstrapScript,
  ThemeProvider,
  useTheme,
} from './theme-provider'

vi.mock('@tanstack/react-router', () => ({
  ScriptOnce: () => null,
}))

function ThemeHarness() {
  const { setTheme, theme } = useTheme()
  return (
    <button type="button" onClick={() => setTheme('dark')}>
      {theme}
    </button>
  )
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    const localStorage = createLocalStorage()
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: localStorage,
    })
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: localStorage,
    })
    document.documentElement.className = ''
    document.documentElement.style.colorScheme = ''
  })

  afterEach(() => {
    cleanup()
  })

  test('applies a user-selected theme immediately without a document transition', () => {
    mockMotionPreference(false)
    render(
      <ThemeProvider theme="light" persistence="local">
        <ThemeHarness />
      </ThemeProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'light' }))

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.hasAttribute('data-theme-transition')).toBe(
      false,
    )
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })

  test('switches immediately without a transition for reduced motion', () => {
    mockMotionPreference(true)
    render(
      <ThemeProvider theme="light" persistence="local">
        <ThemeHarness />
      </ThemeProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'light' }))

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.hasAttribute('data-theme-transition')).toBe(
      false,
    )
  })

  test('bootstraps the cookie-backed server theme before hydration', () => {
    mockMotionPreference(false)
    document.documentElement.className = 'scroll-smooth light'

    Function(createThemeBootstrapScript('dark'))()

    expect(document.documentElement.className).toBe('scroll-smooth dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })

  test('bootstraps a locally persisted theme before hydration', () => {
    mockMotionPreference(false)
    window.localStorage.setItem('patchplane-theme', 'light')
    document.documentElement.className = 'scroll-smooth dark'

    Function(createThemeBootstrapScript('dark', 'local'))()

    expect(document.documentElement.className).toBe('scroll-smooth light')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })

  test('does not reconcile stale loader data after persistence completes', async () => {
    mockMotionPreference(false)
    let completePersistence: (() => void) | undefined
    const persistTheme = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          completePersistence = resolve
        }),
    )
    const view = render(
      <ThemeProvider theme="light" persistTheme={persistTheme}>
        <ThemeHarness />
      </ThemeProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'light' }))
    expect(document.documentElement.className).toBe('dark')

    await act(async () => {
      completePersistence?.()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(document.documentElement.className).toBe('dark')

    view.rerender(
      <ThemeProvider theme="light" persistTheme={persistTheme}>
        <ThemeHarness />
      </ThemeProvider>,
    )
    expect(document.documentElement.className).toBe('dark')
  })

  test('keeps the root theme class under one runtime owner', () => {
    const rootSource = readFileSync(
      join(process.cwd(), 'src/routes/__root.tsx'),
      'utf8',
    )

    expect(rootSource).toMatch(
      /<html\s+lang=\{documentLocale\}\s+className="scroll-smooth"/,
    )
    expect(rootSource).not.toContain("cn('scroll-smooth', theme)")
  })
})

function mockMotionPreference(reducedMotion: boolean) {
  const matchMedia = vi.fn((query: string) => ({
    addEventListener: vi.fn(),
    matches: query === '(prefers-reduced-motion: reduce)' && reducedMotion,
    media: query,
    removeEventListener: vi.fn(),
  }))
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: matchMedia,
  })
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    value: matchMedia,
  })
}

function createLocalStorage(): Storage {
  const values = new Map<string, string>()
  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size
    },
    removeItem: (key) => {
      values.delete(key)
    },
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
}
