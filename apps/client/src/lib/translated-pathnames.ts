import type { FileRoutesByTo } from '../routeTree.gen'
import type { AppLocale } from './i18n'

type RoutePath = keyof FileRoutesByTo

type LocalizedPathnamesInput = Record<RoutePath, Record<AppLocale, string>>

type TranslatedPathname = {
  pattern: string
  localized: Array<[AppLocale, string]>
}

function toUrlPattern(path: string) {
  const pattern = path
    .replace(/\/\$$/, '/:path(.*)?')
    .replace(/\{-\$([a-zA-Z0-9_]+)\}/g, ':$1?')
    .replace(/\$([a-zA-Z0-9_]+)/g, ':$1')
    .replace(/\/+$/, '')

  return pattern === '' ? '/' : pattern
}

function createTranslatedPathnames(
  input: LocalizedPathnamesInput,
): TranslatedPathname[] {
  return Object.entries(input).map(([path, locales]) => ({
    pattern: toUrlPattern(path),
    localized: Object.entries(locales).flatMap(([locale, localizedPath]) =>
      localizedPath === path
        ? []
        : [
            [locale as AppLocale, toUrlPattern(localizedPath)] satisfies [
              AppLocale,
              string,
            ],
          ],
    ),
  }))
}

export const translatedPathnames = createTranslatedPathnames({
  '/': {
    en: '/',
    de: '/de',
  },
  '/about': {
    en: '/about',
    de: '/de/ueber',
  },
  '/app': {
    en: '/app',
    de: '/de/app',
  },
} satisfies LocalizedPathnamesInput)
