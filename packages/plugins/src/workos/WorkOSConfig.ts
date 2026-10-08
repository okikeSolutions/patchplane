import { Config, Schema } from 'effect'

/** WorkOS/AuthKit server configuration for authentication and membership checks. */
export const WorkOSConfig = Config.all({
  apiKey: Config.Redacted('WORKOS_API_KEY'),
  clientId: Config.schema(Schema.NonEmptyString, 'WORKOS_CLIENT_ID'),
  cookiePassword: Config.Redacted('WORKOS_COOKIE_PASSWORD'),
  apiHostname: Config.option(
    Config.schema(Schema.NonEmptyString, 'WORKOS_API_HOSTNAME'),
  ),
})

export type WorkOSConfig =
  typeof WorkOSConfig extends Config.Config<infer A> ? A : never
