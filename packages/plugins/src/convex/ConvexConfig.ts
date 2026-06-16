import { Config } from 'effect'

const convexUrl = Config.url('CONVEX_URL').pipe(
  Config.orElse(() => Config.url('VITE_CONVEX_URL')),
)

export const ConvexConfig = Config.all({
  url: convexUrl,
  trustedWriteSecret: Config.redacted('PATCHPLANE_CONVEX_WRITE_SECRET'),
})

export type ConvexConfig = typeof ConvexConfig extends Config.Config<infer A>
  ? A
  : never
