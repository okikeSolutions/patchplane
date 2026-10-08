import { afterEach, expect, test, vi } from 'vitest'
import { boundedGitHubFetch } from './github-bounded-fetch'

afterEach(() => vi.restoreAllMocks())

test('cancels a response whose declared length exceeds the bound', async () => {
  let cancelled = false
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          cancelled = true
        },
      }),
      { headers: { 'content-length': '10' } },
    ),
  )

  await expect(
    boundedGitHubFetch(4)('https://api.github.test/oversized'),
  ).rejects.toThrow('byte limit')
  expect(cancelled).toBe(true)
})

test('preserves a body-forbidden response with a Cloudflare-style empty stream', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close()
      },
    }),
    headers: new Headers(),
    status: 204,
    statusText: 'No Content',
    url: 'https://api.github.test/installation/token',
  } as Response)

  const response = await boundedGitHubFetch(4)(
    'https://api.github.test/installation/token',
  )

  expect(response.status).toBe(204)
  expect(response.body).toBeNull()
})

test('rejects without waiting for response cancellation to settle', async () => {
  const never = new Promise<void>(() => undefined)
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          return never
        },
      }),
      { headers: { 'content-length': '10' } },
    ),
  )

  await expect(
    boundedGitHubFetch(4)('https://api.github.test/oversized'),
  ).rejects.toThrow('byte limit')
})
