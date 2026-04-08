// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import LocaleSwitcher from './locale-switcher'

const localizeHrefMock = vi.fn<
  (href: string, options: { locale: 'de' | 'en' }) => string
>()
const setLocaleMock = vi.fn<
  (
    locale: 'de' | 'en',
    options?: {
      reload?: boolean
    },
  ) => void | Promise<void>
>()
const navigateMock = vi.fn<(options: { href: string }) => Promise<void>>()

vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({
      location: {
        hash: '',
        pathname: '/app',
        searchStr: '',
      },
    }),
  useNavigate: () => navigateMock,
}))

vi.mock('@/paraglide/runtime', () => ({
  getLocale: () => 'de',
  localizeHref: (href: string, options: { locale: 'de' | 'en' }) =>
    localizeHrefMock(href, options),
  setLocale: (
    locale: 'de' | 'en',
    options?: {
      reload?: boolean
    },
  ) => setLocaleMock(locale, options),
}))

vi.mock('@/paraglide/messages', () => ({
  header_locale_switcher: () => 'Language',
}))

describe('LocaleSwitcher', () => {
  beforeEach(() => {
    localizeHrefMock.mockReset()
    setLocaleMock.mockReset()
    navigateMock.mockReset()

    localizeHrefMock.mockImplementation((href, { locale }) =>
      locale === 'de' ? `/de${href}` : href,
    )
    navigateMock.mockResolvedValue()
  })

  test('switches locale without reloading the document', async () => {
    render(<LocaleSwitcher />)

    const enLink = screen.getByRole('link', { name: 'EN' })
    const deLink = screen.getByRole('link', { name: 'DE' })

    expect(enLink.getAttribute('href')).toBe('/app')
    expect(deLink.getAttribute('href')).toBe('/de/app')

    fireEvent.click(enLink)

    expect(setLocaleMock).toHaveBeenCalledWith('en', { reload: false })
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({ href: '/app' })
    })
  })
})
