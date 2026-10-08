import { describe, expect, it } from 'vitest'
import { githubProviderDeadlineSignal } from './github-provider-deadline'

describe('githubProviderDeadlineSignal', () => {
  it('bounds an acquisition even when the Effect signal remains active', async () => {
    const effectController = new AbortController()
    const signal = githubProviderDeadlineSignal(effectController.signal, 5)

    await new Promise<void>((resolve) =>
      signal.addEventListener('abort', () => resolve(), { once: true }),
    )

    expect(signal.aborted).toBe(true)
    expect(effectController.signal.aborted).toBe(false)
  })

  it('propagates request cancellation before the deadline', () => {
    const effectController = new AbortController()
    const signal = githubProviderDeadlineSignal(effectController.signal, 1_000)

    effectController.abort('cancelled')

    expect(signal.aborted).toBe(true)
    expect(signal.reason).toBe('cancelled')
  })
})
