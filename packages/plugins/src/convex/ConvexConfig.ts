import { Config } from 'effect'

const convexUrl = Config.url('CONVEX_URL').pipe(
  Config.orElse(() => Config.url('VITE_CONVEX_URL')),
)

export const ConvexConfig = Config.all({
  url: convexUrl,
})

export type ConvexConfig = typeof ConvexConfig extends Config.Config<infer A>
  ? A
  : never
