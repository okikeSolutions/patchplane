import type { FileRoutesByTo } from '../routeTree.gen'

export const translatedPathnameLocales = ['en', 'de'] as const
export type TranslatedPathnameLocale = (typeof translatedPathnameLocales)[number]

type RoutePath = keyof FileRoutesByTo

const excludedPaths = ['admin', 'docs', 'api'] as const

type PublicRoutePath = Exclude<
  RoutePath,
  `${string}${(typeof excludedPaths)[number]}${string}`
>

type TranslatedPathname = {
  pattern: string
  localized: Array<[TranslatedPathnameLocale, string]>
}

const localeSet: ReadonlySet<string> = new Set(translatedPathnameLocales)

function isLocale(value: string): value is TranslatedPathnameLocale {
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
  input: Record<PublicRoutePath, Record<TranslatedPathnameLocale, string>>,
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
  '/app': {
    en: '/app',
    de: '/app',
  },
  '/app/workflows/$workflowRunId': {
    en: '/app/workflows/$workflowRunId',
    de: '/app/workflows/$workflowRunId',
  },
})
