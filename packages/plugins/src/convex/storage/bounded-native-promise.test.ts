import { describe, expect, it, vi } from 'vitest'
import { settleConvexMutation } from './bounded-native-promise'

describe('settleConvexMutation', () => {
  it('bounds a stalled Convex mutation', async () => {
    vi.useFakeTimers()
    try {
      let operationSignal: AbortSignal | undefined
      const observed = settleConvexMutation({
        operation: (signal) => {
          operationSignal = signal
          return new Promise<never>(() => undefined)
        },
        operationName: 'test.convexMutation',
        timeoutMilliseconds: 100,
      }).then(
        () => undefined,
        (cause: unknown) => cause,
      )
      await vi.advanceTimersByTimeAsync(101)
      expect(operationSignal?.aborted).toBe(true)
      await expect(observed).resolves.toMatchObject({
        _tag: 'StorageError',
        operation: 'test.convexMutation',
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
