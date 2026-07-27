import { assert, describe, it } from '@effect/vitest'
import {
  sanitizeSentryBreadcrumb,
  sanitizeSentryEvent,
  sanitizeSentryLog,
  sanitizeSentryMetric,
  sanitizeSentrySpan,
  sanitizeSentryTransaction,
} from '@patchplane/plugins/sentry/sanitize'
import { Effect } from 'effect'
import { vi } from 'vitest'

const sentryMocks = vi.hoisted(() => ({
  breadcrumbsIntegration: vi.fn((_options?: unknown) => ({
    name: 'Breadcrumbs',
  })),
  init: vi.fn(),
}))

vi.mock('@sentry/tanstackstart-react', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@sentry/tanstackstart-react')>()
  return {
    ...original,
    breadcrumbsIntegration: sentryMocks.breadcrumbsIntegration,
    init: sentryMocks.init,
  }
})

describe('browser Sentry instrumentation', () => {
  it.effect(
    'disables automatic sensitive collection and bounds breadcrumbs',
    () =>
      Effect.promise(async () => {
        const { initializeClientInstrumentation } =
          await import('./instrument-client-runtime')
        initializeClientInstrumentation()
      }).pipe(
        Effect.andThen(
          Effect.sync(() => {
            assert.strictEqual(sentryMocks.init.mock.calls.length, 1)
            const options = sentryMocks.init.mock.calls[0]?.[0] as
              | Record<string, unknown>
              | undefined

            assert.ok(options !== undefined)
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
            assert.strictEqual(options.sendDefaultPii, false)
            assert.strictEqual(options.beforeSend, sanitizeSentryEvent)
            assert.strictEqual(
              options.beforeSendTransaction,
              sanitizeSentryTransaction,
            )
            assert.strictEqual(
              options.beforeBreadcrumb,
              sanitizeSentryBreadcrumb,
            )
            assert.strictEqual(options.beforeSendLog, sanitizeSentryLog)
            assert.strictEqual(options.beforeSendMetric, sanitizeSentryMetric)
            assert.strictEqual(options.beforeSendSpan, sanitizeSentrySpan)

            const resolveIntegrations = options.integrations as
              | ((defaults: Array<{ readonly name: string }>) => Array<{
                  readonly name: string
                }>)
              | undefined
            assert.ok(resolveIntegrations !== undefined)
            assert.deepStrictEqual(
              resolveIntegrations([
                { name: 'Breadcrumbs' },
                { name: 'Keep' },
              ]).map(({ name }) => name),
              ['Keep', 'Breadcrumbs'],
            )
            assert.deepStrictEqual(
              sentryMocks.breadcrumbsIntegration.mock.calls[0]?.[0],
              { console: false },
            )
          }),
        ),
      ),
  )
})
