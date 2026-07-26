import * as Sentry from '@sentry/cloudflare'
import {
  sanitizeSentryBreadcrumb,
  sanitizeSentryEvent,
  sanitizeSentryLog,
  sanitizeSentryMetric,
  sanitizeSentrySpan,
  sanitizeSentryTransaction,
} from './sanitize'

export type CloudflareSentryEnv = {
  readonly CLOUDFLARE_SENTRY_DSN: string
}

/** Wraps a Cloudflare Worker entry with request-scoped Sentry error capture. */
export function withCloudflareSentry<
  Env extends CloudflareSentryEnv,
  Handler extends { fetch(request: Request, env?: Env): Promise<Response> },
>(handler: Handler): Handler {
  return Sentry.withSentry<Env, unknown, unknown, never>(
    (env: Env | undefined) => ({
      dsn: env?.CLOUDFLARE_SENTRY_DSN,
      environment: 'development',
      enableLogs: false,
      tracesSampleRate: 1,
      sendDefaultPii: false,
      beforeSend: sanitizeSentryEvent,
      beforeSendTransaction: sanitizeSentryTransaction,
      beforeBreadcrumb: sanitizeSentryBreadcrumb,
      beforeSendLog: sanitizeSentryLog,
      beforeSendMetric: sanitizeSentryMetric,
      beforeSendSpan: sanitizeSentrySpan,
    }),
    // Sentry's Worker globals differ from DOM Request types used by TanStack Start.
    handler as never,
  )
}
