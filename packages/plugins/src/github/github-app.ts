import { Option, Redacted } from 'effect'
import { App, Octokit } from 'octokit'
import type { GitHubConfig } from './GitHubConfig'

export function makeGitHubApp(config: GitHubConfig) {
  const baseUrl = Option.getOrUndefined(config.baseUrl)
  const OctokitForApp = baseUrl === undefined ? Octokit : Octokit.defaults({ baseUrl })

  return {
    baseUrl,
    app: new App({
      appId: config.appId,
      privateKey: Redacted.value(config.privateKey).replaceAll('\\n', '\n'),
      webhooks: { secret: Redacted.value(config.webhookSecret) },
      Octokit: OctokitForApp,
    }),
  }
}
