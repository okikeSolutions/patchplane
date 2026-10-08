import { Config, Schema } from 'effect'

/** GitHub accepts either the numeric App ID or the 20-character client ID as JWT issuer. */
const GitHubAppId = Schema.String.check(
  Schema.isPattern(/^(?:[1-9]\d*|[A-Za-z0-9]{20})$/),
)

export const GitHubConfig = Config.all({
  appId: Config.schema(GitHubAppId, 'GITHUB_APP_ID'),
  clientId: Config.NonEmptyString('GITHUB_CLIENT_ID'),
  clientSecret: Config.Redacted('GITHUB_CLIENT_SECRET'),
  oauthCallbackUrl: Config.NonEmptyString(
    'PATCHPLANE_GITHUB_OAUTH_CALLBACK_URL',
  ),
  privateKey: Config.Redacted('GITHUB_PRIVATE_KEY'),
  webhookSecret: Config.Redacted('GITHUB_WEBHOOK_SECRET'),
  baseUrl: Config.option(
    Config.URL('GITHUB_BASE_URL').pipe(Config.map((url) => url.toString())),
  ),
})

export type GitHubConfig =
  typeof GitHubConfig extends Config.Config<infer A> ? A : never
