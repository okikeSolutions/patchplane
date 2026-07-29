import { assert, describe, it } from '@effect/vitest'
import { vi } from 'vitest'

const sentryMocks = vi.hoisted(() => ({
  captureCloudflareRequestFailure: vi.fn(),
  convexMutation: vi.fn(
    async (..._args: unknown[]): Promise<unknown> => ({
      accepted: true,
      deliveryToken: 'delivery-token-1',
    }),
  ),
  convexQuery: vi.fn(async (): Promise<unknown> => []),
}))

vi.mock('convex/browser', () => ({
  ConvexHttpClient: class {
    mutation = sentryMocks.convexMutation
    query = sentryMocks.convexQuery
  },
}))

vi.mock('@patchplane/plugins/sentry/cloudflare-worker', () => ({
  captureCloudflareRequestFailure: sentryMocks.captureCloudflareRequestFailure,
  withCloudflareSentry: (handler: unknown) => handler,
}))

import worker from './webhook-worker'

const secret = 'webhook-secret'
const payload = JSON.stringify({ action: 'opened' })

async function signature(body: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)),
  )
  return `sha256=${Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')}`
}

async function receiptFor(message: {
  deliveryId: string
  eventName: string
  signature: string
  payload: string
  deliveryToken: string
}) {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      deliveryId: message.deliveryId,
      eventName: message.eventName,
      signature: message.signature,
      payload: message.payload,
    }),
  )
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')
  return {
    status: 'delivering',
    activeDeliveryToken: message.deliveryToken,
    envelopeStorageKey: `webhook-queue/github/${message.deliveryId}/${digest}.json`,
    envelopeSha256: digest,
  }
}

async function request() {
  return new Request('https://example.com/api/github/webhook', {
    method: 'POST',
    headers: {
      'x-github-delivery': 'delivery-1',
      'x-github-event': 'pull_request',
      'x-hub-signature-256': await signature(payload),
    },
    body: payload,
  })
}

function env(overrides: Record<string, unknown> = {}) {
  return {
    CLOUDFLARE_SENTRY_DSN: '',
    GITHUB_WEBHOOK_SECRET: secret,
    CONVEX_URL: 'https://convex.example',
    PATCHPLANE_SYSTEM_INGESTION_SECRET: 'system-secret',
    VERIFICATION_DEAD_LETTER_QUEUE_NAME: 'verification-dlq',
    VERIFICATION_EXECUTION_QUEUE: { send: vi.fn(async () => undefined) },
    PATCHPLANE_EVIDENCE_BUCKET: {
      put: vi.fn(async () => undefined),
      get: vi.fn(async () => null),
      delete: vi.fn(async () => undefined),
    },
    SOURCE_CONTROL_WORKER: {
      fetch: vi.fn(async () =>
        Response.json(
          {
            ok: true,
            workflowRunId: 'run-1',
            verificationTerminal: true,
            deliveryId: 'delivery-1',
          },
          { status: 202 },
        ),
      ),
    },
    ...overrides,
  }
}

describe('GitHub webhook Worker', () => {
  it('replays a durably stored queued envelope from the scheduled outbox', async () => {
    const message = {
      deliveryId: 'delivery-1',
      eventName: 'pull_request',
      signature: await signature(payload),
      payload,
    }
    const bytes = new TextEncoder().encode(JSON.stringify(message))
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('')
    const storageKey = `webhook-queue/github/delivery-1/${digest}.json`
    sentryMocks.convexMutation.mockResolvedValueOnce([
      {
        deliveryId: 'delivery-1',
        envelopeStorageKey: storageKey,
        envelopeSha256: digest,
        deliveryToken: 'delivery-token-1',
      },
    ])
    const send = vi.fn(async () => undefined)
    const bindings = env({
      VERIFICATION_EXECUTION_QUEUE: { send },
      PATCHPLANE_EVIDENCE_BUCKET: {
        put: vi.fn(async () => undefined),
        get: vi.fn(async () => ({
          size: bytes.byteLength,
          arrayBuffer: async () => bytes.buffer,
        })),
        delete: vi.fn(async () => undefined),
      },
    })

    await worker.scheduled(undefined, bindings)

    assert.deepStrictEqual(send.mock.calls, [
      [{ ...message, deliveryToken: 'delivery-token-1' }],
    ])
  })

  it('authenticates and enqueues a bounded webhook without dispatching inline', async () => {
    const bindings = env()
    const response = await worker.fetch(await request(), bindings)

    assert.strictEqual(response.status, 202)
    assert.deepStrictEqual(await response.json(), {
      ok: true,
      queued: true,
      deliveryId: 'delivery-1',
    })
    assert.strictEqual(
      bindings.VERIFICATION_EXECUTION_QUEUE.send.mock.calls.length,
      1,
    )
    assert.strictEqual(
      bindings.SOURCE_CONTROL_WORKER.fetch.mock.calls.length,
      0,
    )
  })

  it('rejects an unauthenticated webhook before queueing', async () => {
    const bindings = env()
    const invalid = await request()
    invalid.headers.set('x-hub-signature-256', `sha256=${'0'.repeat(64)}`)
    const response = await worker.fetch(invalid, bindings)

    assert.strictEqual(response.status, 401)
    assert.strictEqual(
      bindings.VERIFICATION_EXECUTION_QUEUE.send.mock.calls.length,
      0,
    )
  })

  it('retries incomplete execution and acknowledges only a durable sandbox result', async () => {
    const ack = vi.fn()
    const retry = vi.fn()
    const messageBody = {
      deliveryId: 'delivery-1',
      eventName: 'pull_request',
      signature: await signature(payload),
      payload,
      deliveryToken: 'delivery-token-1',
    }
    const message = { body: messageBody, ack, retry }
    sentryMocks.convexQuery.mockResolvedValueOnce(await receiptFor(messageBody))
    sentryMocks.convexMutation
      .mockResolvedValueOnce('claimed')
      .mockResolvedValueOnce(true)
    const incomplete = env({
      SOURCE_CONTROL_WORKER: {
        fetch: vi.fn(async () =>
          Response.json({ ok: true, workflowRunId: 'run-1' }, { status: 202 }),
        ),
      },
    })
    await worker.queue(
      {
        queue: 'verification-execution',
        messages: [message],
      } as unknown as Parameters<typeof worker.queue>[0],
      incomplete,
    )
    assert.strictEqual(ack.mock.calls.length, 0)
    assert.deepStrictEqual(retry.mock.calls, [[{ delaySeconds: 30 }]])

    retry.mockClear()
    sentryMocks.convexQuery.mockResolvedValueOnce(await receiptFor(messageBody))
    sentryMocks.convexMutation
      .mockResolvedValueOnce('claimed')
      .mockResolvedValueOnce(true)
    await worker.queue(
      {
        queue: 'verification-execution',
        messages: [message],
      } as unknown as Parameters<typeof worker.queue>[0],
      env(),
    )
    assert.strictEqual(ack.mock.calls.length, 1)
    assert.strictEqual(retry.mock.calls.length, 0)
  })

  it('rejects oversized service-binding responses before acknowledgement', async () => {
    const ack = vi.fn()
    const retry = vi.fn()
    const messageBody = {
      deliveryId: 'delivery-1',
      eventName: 'pull_request',
      signature: await signature(payload),
      payload,
      deliveryToken: 'delivery-token-1',
    }
    sentryMocks.convexQuery.mockResolvedValueOnce(await receiptFor(messageBody))
    sentryMocks.convexMutation
      .mockResolvedValueOnce('claimed')
      .mockResolvedValueOnce(true)
    const oversized = JSON.stringify({
      ok: true,
      verificationTerminal: true,
      deliveryId: 'delivery-1',
      padding: 'x'.repeat(20 * 1024),
    })
    await worker.queue(
      {
        queue: 'verification-execution',
        messages: [{ body: messageBody, ack, retry }],
      } as unknown as Parameters<typeof worker.queue>[0],
      env({
        SOURCE_CONTROL_WORKER: {
          fetch: vi.fn(async () =>
            new Response(oversized, {
              status: 202,
              headers: { 'content-type': 'application/json' },
            }),
          ),
        },
      }),
    )
    assert.strictEqual(ack.mock.calls.length, 0)
    assert.deepStrictEqual(retry.mock.calls, [[{ delaySeconds: 30 }]])
  })

  it('keeps the owned deadline active while reading a response body', async () => {
    const ack = vi.fn()
    const retry = vi.fn()
    const messageBody = {
      deliveryId: 'delivery-1',
      eventName: 'pull_request',
      signature: await signature(payload),
      payload,
      deliveryToken: 'delivery-token-1',
    }
    sentryMocks.convexQuery.mockResolvedValueOnce(await receiptFor(messageBody))
    sentryMocks.convexMutation
      .mockResolvedValueOnce('claimed')
      .mockResolvedValueOnce(true)
    let markHeadersReturned: (() => void) | undefined
    const headersReturned = new Promise<void>((resolve) => {
      markHeadersReturned = resolve
    })
    vi.useFakeTimers()
    try {
      const pending = worker.queue(
        {
          queue: 'verification-execution',
          messages: [{ body: messageBody, ack, retry }],
        } as unknown as Parameters<typeof worker.queue>[0],
        env({
          SOURCE_CONTROL_WORKER: {
            fetch: vi.fn(async () => {
              markHeadersReturned?.()
              return new Response(
                new ReadableStream<Uint8Array>({
                  cancel: () => new Promise<void>(() => undefined),
                }),
                {
                  status: 202,
                  headers: { 'content-type': 'application/json' },
                },
              )
            }),
          },
        }),
      )
      await headersReturned
      await vi.advanceTimersByTimeAsync((14 * 60 + 30) * 1_000)
      await pending
    } finally {
      vi.useRealTimers()
    }
    assert.strictEqual(ack.mock.calls.length, 0)
    assert.deepStrictEqual(retry.mock.calls, [[{ delaySeconds: 30 }]])
  })

  it('bounds a never-settling DLQ service binding and retries', async () => {
    const ack = vi.fn()
    const retry = vi.fn()
    const messageBody = {
      deliveryId: 'delivery-1',
      eventName: 'pull_request',
      signature: await signature(payload),
      payload,
      deliveryToken: 'delivery-token-1',
    }
    sentryMocks.convexQuery.mockResolvedValueOnce(await receiptFor(messageBody))
    sentryMocks.convexMutation
      .mockResolvedValueOnce('claimed')
      .mockResolvedValueOnce(true)
    let markBindingReached: (() => void) | undefined
    const bindingReached = new Promise<void>((resolve) => {
      markBindingReached = resolve
    })
    vi.useFakeTimers()
    try {
      const pending = worker.queue(
        {
          queue: 'verification-dlq',
          messages: [{ body: messageBody, ack, retry }],
        } as unknown as Parameters<typeof worker.queue>[0],
        env({
          SOURCE_CONTROL_WORKER: {
            fetch: vi.fn(() => {
              markBindingReached?.()
              return new Promise<Response>(() => undefined)
            }),
          },
        }),
      )
      await bindingReached
      await vi.advanceTimersByTimeAsync(30_000)
      await pending
    } finally {
      vi.useRealTimers()
    }
    assert.strictEqual(ack.mock.calls.length, 0)
    assert.deepStrictEqual(retry.mock.calls, [[{ delaySeconds: 3_600 }]])
  })

  it('acknowledges a DLQ message only after delivery-fenced terminalization', async () => {
    const ack = vi.fn()
    const retry = vi.fn()
    const message = {
      body: {
        deliveryId: 'delivery-1',
        eventName: 'pull_request',
        signature: await signature(payload),
        payload,
        deliveryToken: 'delivery-token-1',
      },
      ack,
      retry,
    }
    sentryMocks.convexQuery.mockResolvedValueOnce(
      await receiptFor(message.body),
    )
    sentryMocks.convexMutation.mockResolvedValueOnce('claimed')
    const bindings = env({
      SOURCE_CONTROL_WORKER: {
        fetch: vi.fn(async () =>
          Response.json({
            ok: true,
            terminalized: true,
            workflowRunId: 'run-1',
          }),
        ),
      },
    })
    await worker.queue(
      {
        queue: 'verification-dlq',
        messages: [message],
      } as unknown as Parameters<typeof worker.queue>[0],
      bindings,
    )
    assert.strictEqual(ack.mock.calls.length, 1)
    assert.strictEqual(retry.mock.calls.length, 0)
  })

  it('captures a queue dispatch failure once and returns a safe response', async () => {
    sentryMocks.captureCloudflareRequestFailure.mockClear()
    const response = await worker.fetch(
      await request(),
      env({
        VERIFICATION_EXECUTION_QUEUE: {
          send: () => Promise.reject(new Error('inner sensitive failure')),
        },
      }),
    )

    assert.strictEqual(response.status, 502)
    assert.deepStrictEqual(
      sentryMocks.captureCloudflareRequestFailure.mock.calls,
      [['github-webhook-worker.queue.send']],
    )
    assert.deepStrictEqual(await response.json(), {
      ok: false,
      error: 'GitHub webhook queue unavailable',
    })
  })
})
