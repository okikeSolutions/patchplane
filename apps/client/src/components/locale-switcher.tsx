import { useRouterState } from '@tanstack/react-router'
import * as m from '@/paraglide/messages'
import { getLocale, localizeHref } from '@/paraglide/runtime'
import { localeLabels, supportedLocales } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { buttonVariants } from './ui/button'

export default function LocaleSwitcher() {
  const { hash, pathname, searchStr } = useRouterState({
    select: (state) => ({
      hash: state.location.hash,
      pathname: state.location.pathname,
      searchStr: state.location.searchStr,
    }),
  })
  const currentLocale = getLocale()
  const currentHref = `${pathname}${searchStr}${hash}`

  return (
    <div
      className="locale-switcher"
      role="group"
      aria-label={m.header_locale_switcher()}
    >
      {supportedLocales.map((locale) => {
        const href = localizeHref(currentHref || '/', { locale })
        const isActive = currentLocale === locale

        return (
          <a
            key={locale}
            href={href}
            hrefLang={locale}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'sm' }),
              'locale-switcher__link',
              isActive && 'locale-switcher__link--active',
            )}
          >
            {localeLabels[locale]}
          </a>
        )
      })}
    </div>
  )
}
