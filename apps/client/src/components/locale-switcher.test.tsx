// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import LocaleSwitcher from './locale-switcher'

const mocks = vi.hoisted(() => ({
  deLocalizeHref: vi.fn<(href: string) => string>(),
  localizeHref: vi.fn<
    (href: string, options: { locale: 'de' | 'en' }) => string
  >(),
  setLocale: vi.fn<
    (
      locale: 'de' | 'en',
      options?: {
        reload?: boolean
      },
    ) => void | Promise<void>
  >(),
  navigate: vi.fn<
    (options: { href: string; reloadDocument?: boolean }) => Promise<void>
  >(),
  getLocale: vi.fn<() => 'de' | 'en'>(),
}))

vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({
      location: {
        hash: '',
        pathname: '/app',
        searchStr: '',
      },
    }),
  useNavigate: () => mocks.navigate,
}))

vi.mock('@/paraglide/runtime', () => ({
  deLocalizeHref: (href: string) => mocks.deLocalizeHref(href),
  getLocale: mocks.getLocale,
  locales: ['en', 'de'],
  localizeHref: (href: string, options: { locale: 'de' | 'en' }) =>
    mocks.localizeHref(href, options),
  setLocale: (
    locale: 'de' | 'en',
    options?: {
      reload?: boolean
    },
  ) => mocks.setLocale(locale, options),
}))

vi.mock('@/paraglide/messages', () => ({
  header_locale_switcher: () => 'Language',
}))

describe('LocaleSwitcher', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    mocks.deLocalizeHref.mockReset()
    mocks.localizeHref.mockReset()
    mocks.setLocale.mockReset()
    mocks.navigate.mockReset()
    mocks.getLocale.mockReset()

    mocks.getLocale.mockReturnValue('de')
    mocks.deLocalizeHref.mockImplementation((href) => href.replace(/^\/(en|de)(?=\/|$)/, '') || '/')
    mocks.localizeHref.mockImplementation((href, { locale }) =>
      locale === 'de' ? `/de${href}` : `/en${href}`,
    )
    mocks.navigate.mockResolvedValue()
  })

  test('switches locale through TanStack navigation without reloading', async () => {
    render(<LocaleSwitcher />)

    fireEvent.click(screen.getByRole('button', { name: /language/i }))

    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'EN' }))

    expect(mocks.deLocalizeHref).toHaveBeenCalledWith('/app')
    expect(mocks.localizeHref).toHaveBeenCalledWith('/app', { locale: 'en' })
    expect(mocks.setLocale).toHaveBeenCalledWith('en', { reload: false })
    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith({
        href: '/en/app',
        reloadDocument: true,
      })
    })
  })

  test('does not navigate when clicking the active locale', async () => {
    render(<LocaleSwitcher />)

    fireEvent.click(screen.getByRole('button', { name: /language/i }))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'DE' }))

    expect(mocks.setLocale).not.toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalled()
  })
})
