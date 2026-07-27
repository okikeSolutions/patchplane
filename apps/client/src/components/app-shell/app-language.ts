import { getLocale, localizeHref } from '@/paraglide/runtime'

export function getAppLocale() {
  return getLocale()
}

export function localizeAppHref(href: string) {
  return localizeHref(href, { locale: getLocale() })
}

export function documentLocaleForPathname(
  _pathname: string,
  routeLocale: 'en' | 'de',
) {
  return routeLocale
}
