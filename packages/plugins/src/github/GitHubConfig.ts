import { Config, Schema } from 'effect'

/** GitHub App credentials and optional Enterprise API endpoint. */
const GitHubAppId = Schema.String.check(
  Schema.isPattern(/^[1-9]\d*$/),
)

export const GitHubConfig = Config.all({
  appId: Config.schema(GitHubAppId, 'GITHUB_APP_ID'),
  privateKey: Config.redacted('GITHUB_PRIVATE_KEY'),
  webhookSecret: Config.redacted('GITHUB_WEBHOOK_SECRET'),
  baseUrl: Config.option(
    Config.url('GITHUB_BASE_URL').pipe(Config.map((url) => url.toString())),
  ),
})

export type GitHubConfig = typeof GitHubConfig extends Config.Config<infer A>
  ? A
  : never
