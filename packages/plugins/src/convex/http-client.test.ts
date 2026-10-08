import { describe, expect, it, vi } from 'vitest'
import { Effect, Fiber } from 'effect'
import { fetchWithSignal } from '../http/sdk-fetch-boundary'

describe('fetchWithSignal', () => {
  it('aborts the native fetch when its Effect is interrupted', async () => {
    const originalFetch = globalThis.fetch
    let observedSignal: AbortSignal | undefined
    let notifyFetchStarted: (() => void) | undefined
    const fetchStarted = new Promise<void>((resolve) => {
      notifyFetchStarted = resolve
    })
    globalThis.fetch = vi.fn((_input, init) => {
      observedSignal = init?.signal ?? undefined
      notifyFetchStarted?.()
      return new Promise<Response>((_resolve, reject) => {
        observedSignal?.addEventListener(
          'abort',
          () => reject(observedSignal?.reason),
          { once: true },
        )
      })
    }) as typeof globalThis.fetch

    try {
      const fiber = Effect.runFork(
        Effect.tryPromise({
          try: (signal) => fetchWithSignal(signal)('https://example.test'),
          catch: () => 'fetch failed' as const,
        }),
      )
      await fetchStarted
      await Effect.runPromise(Fiber.interrupt(fiber))
      expect(observedSignal?.aborted).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('combines Effect, Request, and fetch-init signals', async () => {
    const originalFetch = globalThis.fetch
    const effectController = new AbortController()
    const requestController = new AbortController()
    const initController = new AbortController()
    let observedSignal: AbortSignal | undefined
    globalThis.fetch = vi.fn((_input, init) => {
      observedSignal = init?.signal ?? undefined
      return Promise.resolve(new Response())
    }) as typeof globalThis.fetch

    try {
      await fetchWithSignal(effectController.signal)(
        new Request('https://example.test', {
          signal: requestController.signal,
        }),
        { signal: initController.signal },
      )
      initController.abort('sdk aborted')
      expect(observedSignal?.aborted).toBe(true)
      expect(observedSignal?.reason).toBe('sdk aborted')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
