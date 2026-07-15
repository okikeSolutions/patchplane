import { localizeHref } from '../paraglide/runtime'

export const prerenderRoutes = ['/'].map((path) => ({
  path: localizeHref(path),
  prerender: {
    enabled: true,
  },
}))
