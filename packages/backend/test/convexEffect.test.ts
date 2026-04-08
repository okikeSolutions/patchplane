import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { tryConvexPromise } from '../src/effect/convex'
import { ConvexInteropFailure } from '../src/errors'

describe('tryConvexPromise', () => {
  test('maps rejected promises into typed Convex interop failures', async () => {
    const cause = new Error('mutation failed')
    const result = await Effect.runPromise(
      Effect.either(
        tryConvexPromise('mutation workflows.failWorkflowRunExecution', () =>
          Promise.reject(cause),
        ),
      ),
    )

    expect(result._tag).toBe('Left')
    if (result._tag !== 'Left') {
      throw new Error('Expected Convex interop failure.')
    }

    expect(result.left).toBeInstanceOf(ConvexInteropFailure)
    expect(result.left.operation).toBe(
      'mutation workflows.failWorkflowRunExecution',
    )
    expect(result.left.cause).toBe(cause)
  })

  test('passes successful promise results through unchanged', async () => {
    const result = await Effect.runPromise(
      tryConvexPromise(
        'query github.getWebhookDeliveryForProcessing',
        async () => ({
          ok: true as const,
        }),
      ),
    )

    expect(result).toEqual({ ok: true })
  })
})
