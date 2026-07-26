import { Config } from 'effect'

const convexUrl = Config.all({
  canonical: Config.option(Config.url('CONVEX_URL')),
  legacy: Config.option(Config.url('VITE_CONVEX_URL')),
})

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
