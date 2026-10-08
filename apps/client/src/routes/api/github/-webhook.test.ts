// @vitest-environment jsdom

import { describe, expect, test } from 'vitest'
import { githubWebhookGoneResponse } from './webhook'

describe('GitHub webhook route', () => {
  test('keeps client API route closed because hosted webhooks use GitHubWebhookWorker', async () => {
    const response = githubWebhookGoneResponse()
    const body = await response.json()

    expect(response.status).toBe(410)
    expect(body).toEqual({
      ok: false,
      error:
        'GitHub webhooks are handled by the dedicated GitHubWebhookWorker in hosted Cloudflare deployments',
    })
  })
})
