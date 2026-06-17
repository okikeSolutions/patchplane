import { Config } from 'effect'

export const GitHubConfig = Config.all({
  appId: Config.string('GITHUB_APP_ID'),
  privateKey: Config.redacted('GITHUB_PRIVATE_KEY'),
  webhookSecret: Config.redacted('GITHUB_WEBHOOK_SECRET'),
  baseUrl: Config.option(Config.string('GITHUB_BASE_URL')),
})

export type GitHubConfig = typeof GitHubConfig extends Config.Config<infer A>
  ? A
  : never
