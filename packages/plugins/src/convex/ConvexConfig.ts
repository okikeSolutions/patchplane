import { Config } from 'effect'

const convexUrl = Config.all({
  canonical: Config.option(Config.URL('CONVEX_URL')),
  legacy: Config.option(Config.URL('VITE_CONVEX_URL')),
})

/** Convex storage plugin configuration read from deployment environment. */
export const ConvexConfig = Config.all({
  url: convexUrl,
  systemIngestionSecret: Config.option(
    Config.Redacted('PATCHPLANE_SYSTEM_INGESTION_SECRET'),
  ),
})

export type ConvexConfig =
  typeof ConvexConfig extends Config.Config<infer A> ? A : never
