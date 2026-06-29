import type { FileRoutesByTo } from '../routeTree.gen'
import { locales, type Locale } from '../paraglide/runtime'

type RoutePath = keyof FileRoutesByTo

const excludedPaths = ['admin', 'docs', 'api'] as const

type PublicRoutePath = Exclude<
  RoutePath,
  `${string}${(typeof excludedPaths)[number]}${string}`
>

type TranslatedPathname = {
  pattern: string
  localized: Array<[Locale, string]>
}

const localeSet: ReadonlySet<string> = new Set(locales)

function isLocale(value: string): value is Locale {
  return localeSet.has(value)
}

function toUrlPattern(path: string) {
  return (
    path
      // catch-all
      .replace(/\/\$$/, '/:path(.*)?')
      // optional parameters: {-$param}
      .replace(/\{-\$([a-zA-Z0-9_]+)\}/g, ':$1?')
      // named parameters: $param
      .replace(/\$([a-zA-Z0-9_]+)/g, ':$1')
      // remove trailing slash
      .replace(/\/+$/, '')
  )
}

function createTranslatedPathnames(
  input: Record<PublicRoutePath, Record<Locale, string>>,
): TranslatedPathname[] {
  return Object.entries(input).map(([pattern, localizedPaths]) => ({
    pattern: toUrlPattern(pattern),
    localized: Object.entries(localizedPaths).map(([locale, path]) => {
      if (!isLocale(locale)) {
        throw new Error(`Unknown locale: ${locale}`)
      }

      return [locale, `/${locale}${toUrlPattern(path)}`]
    }),
  }))
}

export const translatedPathnames = createTranslatedPathnames({
  '/': {
    en: '/',
    de: '/',
  },
  '/about': {
    en: '/about',
    de: '/ueber',
  },
  '/app': {
    en: '/app',
    de: '/app',
  },
  '/app/workflows/$workflowRunId': {
    en: '/app/workflows/$workflowRunId',
    de: '/app/workflows/$workflowRunId',
  },
})
