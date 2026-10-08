import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { vi } from 'vitest'
import { forwardSentryTunnelEnvelope } from './sentry-tunnel'

const allowedDsn = 'https://public@example.com/1'
const hostileDsn = 'https://attacker@attacker.example/2'

function envelope(dsn: string): string {
  return `${JSON.stringify({ dsn })}\n{"type":"event"}\n{"message":"test"}\n`
}

describe('Sentry tunnel boundary', () => {
  it.effect('forwards only envelopes for the configured DSN', () =>
    Effect.promise(async () => {
      const upstream = vi.fn(
        async (_input: RequestInfo | URL) => new Response('accepted'),
      )
      vi.stubGlobal('fetch', upstream)

      const accepted = await forwardSentryTunnelEnvelope(
        new Request('https://patchplane.example/api/e4c1f9a7', {
          method: 'POST',
          body: envelope(allowedDsn),
        }),
        allowedDsn,
      )
      assert.strictEqual(accepted.status, 200)
      assert.strictEqual(upstream.mock.calls.length, 1)
      const forwardedUrl = new URL(String(upstream.mock.calls[0]?.[0]))
      assert.strictEqual(
        forwardedUrl.origin + forwardedUrl.pathname,
        'https://example.com/api/1/envelope/',
      )
      assert.deepStrictEqual(
        [...forwardedUrl.searchParams.entries()].toSorted(),
        [
          ['sentry_key', 'public'],
          ['sentry_version', '7'],
        ],
      )

      const rejected = await forwardSentryTunnelEnvelope(
        new Request('https://patchplane.example/api/e4c1f9a7', {
          method: 'POST',
          body: envelope(hostileDsn),
        }),
        allowedDsn,
      )
      assert.strictEqual(rejected.status, 403)
      assert.strictEqual(upstream.mock.calls.length, 1)
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          vi.unstubAllGlobals()
        }),
      ),
    ),
  )
})
