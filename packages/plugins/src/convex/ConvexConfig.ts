import { Config } from 'effect'

const convexUrl = Config.url('CONVEX_URL').pipe(
  Config.orElse(() => Config.url('VITE_CONVEX_URL')),
)

/** Convex storage plugin configuration read from deployment environment. */
export const ConvexConfig = Config.all({
  url: convexUrl,
  systemIngestionSecret: Config.option(
    Config.redacted('PATCHPLANE_SYSTEM_INGESTION_SECRET'),
  ),
})

export type ConvexConfig = typeof ConvexConfig extends Config.Config<infer A>
  ? A
  : never
