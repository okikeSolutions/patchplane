import { assert, describe, it } from '@effect/vitest'
import { vi } from 'vitest'

const sentryMocks = vi.hoisted(() => ({
  httpServerIntegration: vi.fn((_options?: unknown) => ({ name: 'Http' })),
  withScope: vi.fn((callback: (scope: unknown) => unknown) =>
    callback({ setContext: vi.fn(), setTag: vi.fn() }),
  ),
  withSentry: vi.fn(
    (
      _options: (env: { readonly CLOUDFLARE_SENTRY_DSN: string }) => unknown,
      handler: unknown,
    ) => handler,
  ),
}))

vi.mock('@sentry/cloudflare', async (importOriginal) => {
  const original = await importOriginal<typeof import('@sentry/cloudflare')>()
  return {
    ...original,
    httpServerIntegration: sentryMocks.httpServerIntegration,
    withScope: sentryMocks.withScope,
    withSentry: sentryMocks.withSentry,
  }
})

import {
  captureCloudflareRequestFailure,
  withCloudflareSentry,
} from './cloudflare-worker'

describe('withCloudflareSentry', () => {
  it('disables automatic sensitive collection at the Worker boundary', () => {
    const handler = {
      fetch: async (
        _request: Request,
        _env?: { readonly CLOUDFLARE_SENTRY_DSN: string },
      ) => new Response('ok'),
    }

    assert.strictEqual(withCloudflareSentry(handler), handler)
    assert.strictEqual(sentryMocks.withSentry.mock.calls.length, 1)

    const makeOptions = sentryMocks.withSentry.mock.calls[0]?.[0]
    assert.ok(makeOptions !== undefined)
    const options = makeOptions({
      CLOUDFLARE_SENTRY_DSN: 'https://public@example.com/1',
    }) as Record<string, unknown>

    assert.deepStrictEqual(options.dataCollection, {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: false, response: false },
      httpBodies: [],
      queryParams: false,
      genAI: { inputs: false, outputs: false },
      stackFrameVariables: false,
      frameContextLines: 0,
    })
    assert.strictEqual(options.maxBreadcrumbs, 64)
    const resolveIntegrations = options.integrations as
      | ((defaults: Array<{ readonly name: string }>) => Array<{
          readonly name: string
        }>)
      | undefined
    assert.ok(resolveIntegrations !== undefined)
    assert.deepStrictEqual(
      resolveIntegrations([{ name: 'Console' }, { name: 'Keep' }]).map(
        ({ name }) => name,
      ),
      ['Keep', 'Http'],
    )
    assert.strictEqual(sentryMocks.httpServerIntegration.mock.calls.length, 1)
    assert.deepStrictEqual(
      sentryMocks.httpServerIntegration.mock.calls[0]?.[0],
      { maxRequestBodySize: 'none' },
    )
  })

  it('never lets a capture SDK defect escape the request boundary', () => {
    sentryMocks.withScope.mockImplementationOnce(() => {
      throw new Error('sdk failure')
    })

    assert.doesNotThrow(() =>
      captureCloudflareRequestFailure('source-control.worker.fetch'),
    )
  })
})
