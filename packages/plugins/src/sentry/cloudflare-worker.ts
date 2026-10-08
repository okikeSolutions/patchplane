import * as Sentry from '@sentry/cloudflare'
import {
  makeSentryDataCollection,
  sanitizeSentryBreadcrumb,
  sanitizeSentryEvent,
  sanitizeSentryLog,
  sanitizeSentryMetric,
  sanitizeSentryException,
  sanitizeSentryStreamedSpan,
  sentryMaxBreadcrumbs,
} from './sanitize'

export type CloudflareSentryEnv = {
  readonly CLOUDFLARE_SENTRY_DSN: string
}

/** Captures a boundary-owned failure without accepting the untrusted cause. */
export function captureCloudflareRequestFailure(
  operation:
    | 'source-control.worker.fetch'
    | 'github-webhook-worker.service-binding.fetch'
    | 'github-webhook-worker.queue.send'
    | 'github-webhook-worker.queue.service-binding',
): void {
  try {
    Sentry.withScope((scope) => {
      scope.setTag('operation', operation)
      scope.setContext('patchplane.error', {
        message: 'Captured PatchPlane request boundary failure',
      })
      Sentry.captureException(
        sanitizeSentryException(
          new Error('Captured PatchPlane request boundary failure'),
        ),
      )
    })
  } catch {
    // Operational telemetry must never alter the request response.
  }
}

/** Wraps a Cloudflare Worker entry with request-scoped Sentry error capture. */
export function withCloudflareSentry<
  Env extends CloudflareSentryEnv,
  Handler extends { fetch(request: Request, env?: Env): Promise<Response> },
>(handler: Handler): Handler
export function withCloudflareSentry<
  Env extends CloudflareSentryEnv,
  RequestContext,
  Handler extends {
    fetch(
      request: Request,
      env: Env,
      context: RequestContext,
    ): Promise<Response>
  },
>(handler: Handler): Handler
export function withCloudflareSentry(handler: unknown): unknown {
  return Sentry.withSentry<CloudflareSentryEnv>(
    (env: CloudflareSentryEnv | undefined) => ({
      dsn: env?.CLOUDFLARE_SENTRY_DSN,
      environment: 'development',
      tracesSampleRate: 1,
      dataCollection: makeSentryDataCollection(),
      maxBreadcrumbs: sentryMaxBreadcrumbs,
      integrations: (defaultIntegrations) => [
        ...defaultIntegrations.filter(
          (integration) => integration.name !== 'Console',
        ),
        Sentry.httpServerIntegration({ maxRequestBodySize: 'none' }),
      ],
      beforeSend: sanitizeSentryEvent,
      beforeBreadcrumb: sanitizeSentryBreadcrumb,
      beforeSendLog: sanitizeSentryLog,
      beforeSendMetric: sanitizeSentryMetric,
      beforeSendSpan: sanitizeSentryStreamedSpan,
    }),
    // Sentry's Worker globals differ from DOM Request types used by TanStack Start.
    handler as never,
  )
}
