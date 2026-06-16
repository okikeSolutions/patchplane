import { Config } from 'effect'

export const WorkOSConfig = Config.all({
  apiKey: Config.redacted('WORKOS_API_KEY'),
  clientId: Config.string('WORKOS_CLIENT_ID'),
  cookiePassword: Config.redacted('WORKOS_COOKIE_PASSWORD'),
  apiHostname: Config.option(Config.string('WORKOS_API_HOSTNAME')),
})

export type WorkOSConfig = typeof WorkOSConfig extends Config.Config<infer A>
  ? A
  : never
