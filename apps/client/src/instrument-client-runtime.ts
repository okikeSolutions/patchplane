import {
  makeSentryDataCollection,
  sanitizeSentryBreadcrumb,
  sanitizeSentryEvent,
  sanitizeSentryLog,
  sanitizeSentryMetric,
  sanitizeSentrySpan,
  sanitizeSentryTransaction,
  sentryMaxBreadcrumbs,
} from '@patchplane/plugins/sentry/sanitize'
import * as Sentry from '@sentry/tanstackstart-react'

export function initializeClientInstrumentation() {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: 'development',
    enableLogs: false,
    sendDefaultPii: false,
    dataCollection: makeSentryDataCollection(),
    maxBreadcrumbs: sentryMaxBreadcrumbs,
    tracesSampleRate: 1,
    integrations: (defaultIntegrations) => [
      ...defaultIntegrations.filter(
        (integration) => integration.name !== 'Breadcrumbs',
      ),
      Sentry.breadcrumbsIntegration({ console: false }),
    ],
    beforeSend: sanitizeSentryEvent,
    beforeSendTransaction: sanitizeSentryTransaction,
    beforeBreadcrumb: sanitizeSentryBreadcrumb,
    beforeSendLog: sanitizeSentryLog,
    beforeSendMetric: sanitizeSentryMetric,
    beforeSendSpan: sanitizeSentrySpan,
    tunnel: '/api/e4c1f9a7',
  })
}
