import { Effect, Schema } from 'effect'
import { WorkflowStateError } from '@patchplane/domain/errors'
import { describe, expect, it, vi } from 'vitest'
import { effectServerFnHandlers } from './effect-server-fn'

vi.mock('@/effect/runtime', () => ({
  patchPlaneRuntime: {
    runPromiseExit: (effect: Effect.Effect<unknown, unknown, never>) =>
      Effect.runPromiseExit(effect),
  },
}))

vi.mock('@patchplane/core/services/telemetry-service', () => ({
  captureTelemetryCause: () => Effect.void,
  withCriticalPathBreadcrumbScope: (effect: Effect.Effect<unknown>) => effect,
  withTelemetrySpan: (_span: unknown, effect: Effect.Effect<unknown>) => effect,
}))

const Input = Schema.Struct({ value: Schema.String })

describe('Effect server-function adapter', () => {
  it('decodes input before passing data to the handler', async () => {
    const handlers = effectServerFnHandlers({
      input: Input,
      operation: 'test.decode-input',
      effect: ({ value }) => Effect.succeed({ value }),
    })

    await expect(handlers.validator({ value: 42 })).rejects.toMatchObject({
      _tag: 'ValidationError',
    })
    await expect(handlers.validator({ value: 'valid' })).resolves.toEqual({
      value: 'valid',
    })
  })

  it('returns successful handler results through the runtime bridge', async () => {
    const handlers = effectServerFnHandlers({
      input: Input,
      operation: 'test.success',
      effect: ({ value }) => Effect.succeed({ accepted: value }),
    })

    await expect(
      handlers.handler({ data: { value: 'patch' } }),
    ).resolves.toMatchObject({
      ok: true,
      data: { accepted: 'patch' },
    })
  })

  it('maps typed handler failures to the server-function result', async () => {
    const handlers = effectServerFnHandlers({
      input: Input,
      operation: 'test.failure',
      effect: () =>
        Effect.fail(
          new WorkflowStateError({ message: 'provider unavailable' }),
        ),
      failure: () => ({ code: 'request_failed' }),
    })

    await expect(
      handlers.handler({ data: { value: 'patch' } }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'request_failed',
      traceId: expect.any(String),
    })
  })
})
