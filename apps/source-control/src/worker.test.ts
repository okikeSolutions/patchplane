import { describe, expect, it, vi } from 'vitest'
import { it as effectIt } from '@effect/vitest'
import {
  Cause,
  Effect,
  Exit,
  Fiber,
  Layer,
  ManagedRuntime,
  Ref,
  Schema,
} from 'effect'
import { TestClock } from 'effect/testing'
import { settleConvexMutation } from '@patchplane/plugins/convex/bounded-native-promise'
import type { SourceControlRuntime } from './github/routes'
import {
  validWebhookHeaders,
  withPreparedWebhookInterruptionFinalizer,
} from './github/routes/handleGitHubWebhook'
import { queuedDeliveryExhaustedRequestSchema } from './github/routes/markQueuedDeliveryExhausted'
import {
  claimWithPublishedDispatchToken,
  withPreparedRerunInterruptionFinalizer,
  withRerunInterruptionFinalizer,
  withRerunFixtureDeadline,
} from './github/routes/executeWorkflowRerun'
import {
  publishDecisionRequestSchema,
  readBoundedJson,
  runtimeControlRequestSchema,
} from './github/routes/support'
import {
  finalizeSourceControlRoute,
  runGitHubWebhookRoute,
  runPublishDecisionRoute,
  runQueuedDeliveryExhaustedRoute,
  runRuntimeControlRoute,
  runSourceControlEffect,
  runWorkflowRerunRoute,
} from './worker'

function runtimeBoundary(input?: {
  readonly response?: Response
  readonly dispose?: Promise<void>
}) {
  const response = input?.response ?? new Response('ok')
  const dispose = input?.dispose ?? Promise.resolve()
  return {
    runPromise: vi.fn(
      (_effect: unknown, _options?: { readonly signal?: AbortSignal }) =>
        Promise.resolve(response),
    ),
    dispose: vi.fn(() => dispose),
  }
}

describe('source-control Worker runtime boundary', () => {
  it('passes the request AbortSignal to the single runtime-control bridge', async () => {
    const controller = new AbortController()
    const request = new Request(
      'https://source-control.test/internal/runtime/control',
      {
        method: 'POST',
        signal: controller.signal,
      },
    )
    const runtime = runtimeBoundary()

    const result = runRuntimeControlRoute(
      request,
      runtime as unknown as SourceControlRuntime,
    )

    expect(runtime.runPromise).toHaveBeenCalledTimes(1)
    expect(runtime.runPromise.mock.calls[0]?.[1]).toEqual({
      signal: request.signal,
    })
    controller.abort()
    expect(request.signal.aborted).toBe(true)
    await expect(result).resolves.toBeInstanceOf(Response)
  })

  it('rejects malformed or oversized GitHub webhook identity headers', () => {
    expect(
      validWebhookHeaders({
        deliveryId: 'delivery-1',
        eventName: 'pull_request',
        signature: `sha256=${'a'.repeat(64)}`,
      }),
    ).toBe(true)
    for (const input of [
      {
        deliveryId: 'x'.repeat(129),
        eventName: 'pull_request',
        signature: `sha256=${'a'.repeat(64)}`,
      },
      {
        deliveryId: 'delivery-1',
        eventName: 'x'.repeat(129),
        signature: `sha256=${'a'.repeat(64)}`,
      },
      {
        deliveryId: 'delivery-1',
        eventName: 'pull_request',
        signature: `sha256=${'A'.repeat(64)}`,
      },
      {
        deliveryId: 'delivery-1',
        eventName: 'pull_request',
        signature: 'sha256=short',
      },
    ]) {
      expect(validWebhookHeaders(input)).toBe(false)
    }
  })

  it('bounds a stalled native webhook terminal confirmation', async () => {
    vi.useFakeTimers()
    try {
      const confirmation = settleConvexMutation({
        operation: () => new Promise<unknown>(() => undefined),
        operationName: 'test.webhookTerminalConfirmation',
        timeoutMilliseconds: 100,
      })
      const observed = confirmation.then(
        () => undefined,
        (cause: unknown) => cause,
      )
      await vi.advanceTimersByTimeAsync(101)
      await expect(observed).resolves.toMatchObject({ _tag: 'StorageError' })
    } finally {
      vi.useRealTimers()
    }
  })

  effectIt.effect(
    'rejects oversized decision-publication trace identities',
    () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          Schema.decodeUnknownEffect(publishDecisionRequestSchema)({
            traceId: 'x'.repeat(129),
            workflowRunId: 'workflow-run-1',
            humanDecisionId: 'decision-1',
          }),
        )
        expect(Schema.isSchemaError(error)).toBe(true)
      }),
  )

  effectIt.effect(
    'fails a stalled rerun fixture lookup at its Effect deadline',
    () =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(
          withRerunFixtureDeadline(Effect.never).pipe(Effect.exit),
        )
        yield* TestClock.adjust(15_000)
        const exit = yield* Fiber.join(fiber)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(Cause.squash(exit.cause)).toMatchObject({
            message: 'Rerun workflow lookup timed out',
          })
        }
      }),
  )

  it('passes the request AbortSignal to the single decision-publication bridge', async () => {
    const controller = new AbortController()
    const request = new Request(
      'https://source-control.test/internal/decision/publish',
      { method: 'POST', signal: controller.signal },
    )
    const runtime = runtimeBoundary()

    const result = runPublishDecisionRoute(
      request,
      {},
      runtime as unknown as SourceControlRuntime,
    )

    expect(runtime.runPromise).toHaveBeenCalledTimes(1)
    expect(runtime.runPromise.mock.calls[0]?.[1]).toEqual({
      signal: request.signal,
    })
    controller.abort()
    await expect(result).resolves.toBeInstanceOf(Response)
  })

  effectIt.effect(
    'rejects oversized queued-delivery terminalization identities',
    () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          Schema.decodeUnknownEffect(queuedDeliveryExhaustedRequestSchema)({
            deliveryId: 'delivery-1',
            deliveryToken: 'token-1',
            processingToken: 'x'.repeat(129),
          }),
        )
        expect(Schema.isSchemaError(error)).toBe(true)
      }),
  )

  it('passes the request AbortSignal to the single exhausted-delivery bridge', async () => {
    const controller = new AbortController()
    const request = new Request(
      'https://source-control.test/internal/queue/exhausted',
      { method: 'POST', signal: controller.signal },
    )
    const runtime = runtimeBoundary()

    const result = runQueuedDeliveryExhaustedRoute(
      request,
      {},
      runtime as unknown as SourceControlRuntime,
    )

    expect(runtime.runPromise).toHaveBeenCalledTimes(1)
    expect(runtime.runPromise.mock.calls[0]?.[1]).toEqual({
      signal: request.signal,
    })
    controller.abort()
    await expect(result).resolves.toBeInstanceOf(Response)
  })

  it('passes the request AbortSignal to the single GitHub-webhook bridge', async () => {
    const controller = new AbortController()
    const request = new Request(
      'https://source-control.test/api/github/webhook',
      {
        method: 'POST',
        signal: controller.signal,
      },
    )
    const runtime = runtimeBoundary()

    const result = runGitHubWebhookRoute(
      request,
      {},
      runtime as unknown as SourceControlRuntime,
    )

    expect(runtime.runPromise).toHaveBeenCalledTimes(1)
    expect(runtime.runPromise.mock.calls[0]?.[1]).toEqual({
      signal: request.signal,
    })
    controller.abort()
    await expect(result).resolves.toBeInstanceOf(Response)
  })

  it('interrupts prepared webhook execution and runs terminal cleanup through the real bridge', async () => {
    const controller = new AbortController()
    const request = new Request(
      'https://source-control.test/api/github/webhook',
      {
        method: 'POST',
        signal: controller.signal,
      },
    )
    const runtime = ManagedRuntime.make(Layer.empty)
    let prepared = false
    let terminalized = false
    const route = runSourceControlEffect(
      request,
      runtime,
      withPreparedWebhookInterruptionFinalizer({
        prepare: Effect.sync(() => {
          prepared = true
        }),
        effect: Effect.never,
        finalizer: Effect.sync(() => {
          terminalized = true
        }),
      }),
    )

    await vi.waitFor(() => expect(prepared).toBe(true))
    controller.abort()

    await expect(route).rejects.toBeDefined()
    expect(terminalized).toBe(true)
    await runtime.dispose()
  })

  it('bounds stalled webhook terminal persistence during real bridge cancellation', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const request = new Request(
      'https://source-control.test/api/github/webhook',
      { method: 'POST', signal: controller.signal },
    )
    const runtime = ManagedRuntime.make(Layer.empty)
    let prepared = false
    const route = runSourceControlEffect(
      request,
      runtime,
      withPreparedWebhookInterruptionFinalizer({
        prepare: Effect.sync(() => {
          prepared = true
        }),
        effect: Effect.never,
        finalizer: Effect.promise(() =>
          settleConvexMutation({
            operation: () => new Promise<unknown>(() => undefined),
            operationName: 'test.webhookTerminalConfirmation',
            timeoutMilliseconds: 100,
          }),
        ),
      }),
    )

    const observed = route.then(
      () => undefined,
      (cause: unknown) => cause,
    )
    try {
      await vi.waitFor(() => expect(prepared).toBe(true))
      controller.abort()
      await vi.advanceTimersByTimeAsync(101)
      await expect(observed).resolves.toBeDefined()
    } finally {
      vi.useRealTimers()
      await runtime.dispose()
    }
  })

  it('passes the request AbortSignal to the single workflow-rerun bridge', async () => {
    const controller = new AbortController()
    const request = new Request(
      'https://source-control.test/internal/workflow/rerun',
      {
        method: 'POST',
        signal: controller.signal,
      },
    )
    const runtime = runtimeBoundary()

    const result = runWorkflowRerunRoute(
      request,
      {},
      runtime as unknown as SourceControlRuntime,
    )

    expect(runtime.runPromise).toHaveBeenCalledTimes(1)
    expect(runtime.runPromise.mock.calls[0]?.[1]).toEqual({
      signal: request.signal,
    })
    controller.abort()
    await expect(result).resolves.toBeInstanceOf(Response)
  })

  it('runs workflow-rerun terminal cleanup when request cancellation interrupts execution', async () => {
    const controller = new AbortController()
    let terminalized = false
    const result = Effect.runPromise(
      withRerunInterruptionFinalizer(
        Effect.never,
        Effect.sync(() => {
          terminalized = true
        }),
      ),
      { signal: controller.signal },
    )

    controller.abort()

    await expect(result).rejects.toBeDefined()
    expect(terminalized).toBe(true)
  })

  it('atomically publishes an incoming token before earlier work becomes interruptible', async () => {
    const controller = new AbortController()
    const activeToken = await Effect.runPromise(
      Ref.make<string | undefined>(undefined),
    )
    let prepared = false
    let terminalToken: string | undefined
    const result = Effect.runPromise(
      withPreparedRerunInterruptionFinalizer({
        prepare: Effect.sync(() => {
          prepared = true
          return Ref.set(activeToken, 'ab'.repeat(16))
        }).pipe(Effect.flatten),
        effect: Effect.never,
        finalizer: Ref.get(activeToken).pipe(
          Effect.tap((token) =>
            Effect.sync(() => {
              terminalToken = token
            }),
          ),
        ),
      }),
      { signal: controller.signal },
    )

    await vi.waitFor(() => expect(prepared).toBe(true))
    controller.abort()

    await expect(result).rejects.toBeDefined()
    expect(terminalToken).toBe('ab'.repeat(16))
  })

  it('publishes the dispatch token before a committed claim can be interrupted', async () => {
    const controller = new AbortController()
    let claimCommitted = false
    let terminalToken: string | undefined
    const result = Effect.runPromise(
      Effect.gen(function* () {
        const activeToken = yield* Ref.make<string | undefined>(undefined)
        return yield* withRerunInterruptionFinalizer(
          claimWithPublishedDispatchToken({
            activeToken,
            dispatchToken: 'published-before-claim',
            claim: Effect.sync(() => {
              claimCommitted = true
            }).pipe(Effect.andThen(Effect.never)),
          }),
          Ref.get(activeToken).pipe(
            Effect.tap((token) =>
              Effect.sync(() => {
                terminalToken = token
              }),
            ),
          ),
        )
      }),
      { signal: controller.signal },
    )

    await vi.waitFor(() => expect(claimCommitted).toBe(true))
    controller.abort()

    await expect(result).rejects.toBeDefined()
    expect(terminalToken).toBe('published-before-claim')
  })

  effectIt.effect(
    'retains the prepared token when no incoming dispatch is claimed',
    () =>
      Effect.gen(function* () {
        const activeToken = yield* Ref.make<string | undefined>(undefined)
        yield* claimWithPublishedDispatchToken({
          activeToken,
          dispatchToken: 'retained-tombstone-token',
          claim: Effect.void,
        })
        expect(yield* Ref.get(activeToken)).toBe('retained-tombstone-token')
      }),
  )

  effectIt.effect(
    'does not run workflow-rerun terminal cleanup after ordinary success',
    () =>
      Effect.gen(function* () {
        let terminalized = false
        const result = yield* withRerunInterruptionFinalizer(
          Effect.succeed('accepted'),
          Effect.sync(() => {
            terminalized = true
          }),
        )
        expect(result).toBe('accepted')
        expect(terminalized).toBe(false)
      }),
  )

  it('interrupts the route fiber, runs its finalizer, and disposes the runtime', async () => {
    const controller = new AbortController()
    const request = new Request(
      'https://source-control.test/internal/runtime/control',
      {
        method: 'POST',
        signal: controller.signal,
      },
    )
    const runtime = ManagedRuntime.make(Layer.empty)
    let finalized = false
    const route = runSourceControlEffect(
      request,
      runtime,
      Effect.never.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            finalized = true
          }),
        ),
      ),
    )
    const waited: Promise<unknown>[] = []
    const response = finalizeSourceControlRoute(
      route,
      runtime,
      { waitUntil: (promise) => waited.push(promise) },
      vi.fn(),
    )

    controller.abort()

    await expect(response).resolves.toMatchObject({ status: 500 })
    expect(finalized).toBe(true)
    expect(waited).toHaveLength(1)
    await expect(Promise.all(waited)).resolves.toEqual([undefined])
  })

  effectIt.effect(
    'rejects oversized runtime-control messages before orchestration',
    () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          Schema.decodeUnknownEffect(runtimeControlRequestSchema)({
            workflowRunId: 'workflow-run-1',
            operation: 'steer',
            message: 'x'.repeat(4 * 1024 + 1),
          }),
        )
        expect(Schema.isSchemaError(error)).toBe(true)

        const multibyteError = yield* Effect.flip(
          Schema.decodeUnknownEffect(runtimeControlRequestSchema)({
            workflowRunId: 'workflow-run-1',
            operation: 'steer',
            message: 'é'.repeat(3 * 1024),
          }),
        )
        expect(Schema.isSchemaError(error)).toBe(true)
        expect(Schema.isSchemaError(multibyteError)).toBe(true)
      }),
  )

  it('bounds and aborts runtime-control request body ingestion', async () => {
    const oversized = new Request('https://source-control.test/control', {
      method: 'POST',
      headers: {
        'content-length': String(16 * 1024 + 1),
        'content-type': 'application/json',
      },
      body: '{}',
    })
    await expect(
      Effect.runPromise(readBoundedJson(oversized)),
    ).resolves.toBeUndefined()

    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true
      },
    })
    const stalled = new Request('https://source-control.test/control', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      duplex: 'half',
    } as RequestInit)
    const controller = new AbortController()
    const result = Effect.runPromise(readBoundedJson(stalled), {
      signal: controller.signal,
    })
    controller.abort()
    await expect(result).rejects.toBeDefined()
    expect(cancelled).toBe(true)
  })

  it('schedules runtime disposal after a successful route', async () => {
    const disposal = Promise.resolve()
    const runtime = runtimeBoundary({ dispose: disposal })
    const waited: Promise<unknown>[] = []

    const response = await finalizeSourceControlRoute(
      Promise.resolve(new Response('accepted', { status: 202 })),
      runtime as unknown as Pick<SourceControlRuntime, 'dispose'>,
      { waitUntil: (promise) => waited.push(promise) },
      vi.fn(),
    )

    expect(response.status).toBe(202)
    expect(runtime.dispose).toHaveBeenCalledTimes(1)
    expect(waited).toEqual([disposal])
  })

  it('fails closed and still schedules disposal after a route defect', async () => {
    const disposal = Promise.resolve()
    const runtime = runtimeBoundary({ dispose: disposal })
    const waited: Promise<unknown>[] = []
    const captureFailure = vi.fn()

    const response = await finalizeSourceControlRoute(
      Promise.reject(new Error('secret provider failure')),
      runtime as unknown as Pick<SourceControlRuntime, 'dispose'>,
      { waitUntil: (promise) => waited.push(promise) },
      captureFailure,
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Source-control request failed',
    })
    expect(captureFailure).toHaveBeenCalledWith('source-control.worker.fetch')
    expect(runtime.dispose).toHaveBeenCalledTimes(1)
    expect(waited).toEqual([disposal])
  })
})
