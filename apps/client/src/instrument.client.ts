import {
  sanitizeSentryBreadcrumb,
  sanitizeSentryEvent,
  sanitizeSentryLog,
  sanitizeSentryMetric,
  sanitizeSentrySpan,
  sanitizeSentryTransaction,
} from '@patchplane/plugins/sentry/sanitize'
import * as Sentry from '@sentry/tanstackstart-react'

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: 'development',
  enableLogs: false,
  sendDefaultPii: false,
  tracesSampleRate: 1,
  beforeSend: sanitizeSentryEvent,
  beforeSendTransaction: sanitizeSentryTransaction,
  beforeBreadcrumb: sanitizeSentryBreadcrumb,
  beforeSendLog: sanitizeSentryLog,
  beforeSendMetric: sanitizeSentryMetric,
  beforeSendSpan: sanitizeSentrySpan,
  tunnel: '/api/e4c1f9a7',
})
