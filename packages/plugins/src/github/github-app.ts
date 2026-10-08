import { createPrivateKey } from 'node:crypto'
import { Option, Redacted } from 'effect'
import { App, Octokit } from 'octokit'
import type { GitHubConfig } from './GitHubConfig'
import { boundedGitHubFetch } from './github-bounded-fetch'

export function normalizeGitHubAppPrivateKey(privateKey: string) {
  const normalized = privateKey.replaceAll('\\n', '\n').trim()
  if (!normalized.startsWith('-----BEGIN RSA PRIVATE KEY-----'))
    return normalized

  return createPrivateKey(normalized)
    .export({
      type: 'pkcs8',
      format: 'pem',
    })
    .trim()
}

export function makeGitHubApp(config: GitHubConfig) {
  const baseUrl = Option.getOrUndefined(config.baseUrl)?.replace(/\/+$/, '')
  const OctokitForApp = Octokit.defaults({
    ...(baseUrl === undefined ? {} : { baseUrl }),
    request: { fetch: boundedGitHubFetch(4 * 1_024 * 1_024) },
  })

  return {
    baseUrl,
    app: new App({
      appId: config.appId,
      privateKey: normalizeGitHubAppPrivateKey(
        Redacted.value(config.privateKey),
      ),
      webhooks: { secret: Redacted.value(config.webhookSecret) },
      Octokit: OctokitForApp,
    }),
  }
}
