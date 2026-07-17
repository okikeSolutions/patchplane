import { locales, localizeHref } from '../paraglide/runtime'

export const prerenderRoutes = locales.map((locale) => ({
  path: localizeHref('/', { locale }),
  prerender: {
    enabled: true,
  },
}))
