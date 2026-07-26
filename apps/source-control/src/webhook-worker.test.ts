import { assert, describe, it } from '@effect/vitest'
import { vi } from 'vitest'

const sentryMocks = vi.hoisted(() => ({
  captureCloudflareRequestFailure: vi.fn(),
}))

vi.mock('@patchplane/plugins/sentry/cloudflare-worker', () => ({
  captureCloudflareRequestFailure: sentryMocks.captureCloudflareRequestFailure,
  withCloudflareSentry: (handler: unknown) => handler,
}))

import worker from './webhook-worker'

describe('GitHub webhook Worker', () => {
  it('captures a service-binding dispatch failure once and returns a safe response', async () => {
    const response = await worker.fetch(
      new Request('https://example.com/api/github/webhook', { method: 'POST' }),
      {
        CLOUDFLARE_SENTRY_DSN: '',
        SOURCE_CONTROL_WORKER: {
          fetch: () => Promise.reject(new Error('inner sensitive failure')),
        },
      },
    )

    assert.strictEqual(response.status, 502)
    assert.deepStrictEqual(
      sentryMocks.captureCloudflareRequestFailure.mock.calls,
      [['github-webhook-worker.service-binding.fetch']],
    )
    assert.deepStrictEqual(await response.json(), {
      ok: false,
      error: 'Source-control Worker unavailable',
    })
  })
})
