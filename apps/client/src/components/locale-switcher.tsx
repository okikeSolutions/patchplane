import { useNavigate, useRouterState } from '@tanstack/react-router'
import { Languages } from 'lucide-react'
import * as m from '@/paraglide/messages'
import {
  getLocale,
  locales,
  localizeHref,
  setLocale as setRuntimeLocale,
} from '@/paraglide/runtime'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'

function getLocaleLabel(locale: string) {
  return locale === 'en' ? 'EN' : locale === 'de' ? 'DE' : locale
}

function isLocale(locale: string): locale is (typeof locales)[number] {
  return locales.some((item) => item === locale)
}

export default function LocaleSwitcher() {
  const navigate = useNavigate()
  const { hash, pathname, searchStr } = useRouterState({
    select: (state) => ({
      hash: state.location.hash,
      pathname: state.location.pathname,
      searchStr: state.location.searchStr,
    }),
  })
  const currentLocale = getLocale()
  const currentHref = `${pathname}${searchStr}${hash}`

  async function changeLocale(locale: string) {
    if (locale === currentLocale || !isLocale(locale)) {
      return
    }

    const href = localizeHref(currentHref || '/', { locale })

    await setRuntimeLocale(locale, { reload: false })
    await navigate({ href, reloadDocument: true })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="icon" />}>
        <Languages />
        <span className="sr-only">
          {m.header_locale_switcher()}: {getLocaleLabel(currentLocale)}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-24">
        <DropdownMenuRadioGroup
          value={currentLocale}
          onValueChange={changeLocale}
        >
          <DropdownMenuLabel>{m.header_locale_switcher()}</DropdownMenuLabel>
          {locales.map((locale) => (
            <DropdownMenuRadioItem key={locale} value={locale}>
              {getLocaleLabel(locale)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
