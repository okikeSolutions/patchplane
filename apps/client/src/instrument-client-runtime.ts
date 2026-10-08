import {
  makeSentryDataCollection,
  sanitizeSentryBreadcrumb,
  sanitizeSentryEvent,
  sanitizeSentryLog,
  sanitizeSentryMetric,
  sanitizeSentrySpanName,
  sanitizeSentryStreamedSpan,
  sentryMaxBreadcrumbs,
} from '@patchplane/plugins/sentry/sanitize'
import * as Sentry from '@sentry/react'
import type { Integration } from '@sentry/core'

export const sentryTraceMetadataSanitizer: Integration = {
  name: 'PatchplaneTraceMetadataSanitizer',
  setup(client) {
    client.on('createDsc', (context) => {
      if (context.transaction !== undefined) {
        context.transaction = sanitizeSentrySpanName(context.transaction)
      }
    })
  },
}

export function initializeClientInstrumentation() {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: 'development',
    dataCollection: makeSentryDataCollection(),
    maxBreadcrumbs: sentryMaxBreadcrumbs,
    tracesSampleRate: 1,
    integrations: (defaultIntegrations) => [
      ...defaultIntegrations.filter(
        (integration) =>
          integration.name !== 'Breadcrumbs' && integration.name !== 'Console',
      ),
      sentryTraceMetadataSanitizer,
      Sentry.breadcrumbsIntegration(),
    ],
    beforeSend: sanitizeSentryEvent,
    beforeBreadcrumb: sanitizeSentryBreadcrumb,
    beforeSendLog: sanitizeSentryLog,
    beforeSendMetric: sanitizeSentryMetric,
    beforeSendSpan: sanitizeSentryStreamedSpan,
    tunnel: '/api/e4c1f9a7',
  })
}
