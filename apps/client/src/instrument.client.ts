import * as Sentry from '@sentry/tanstackstart-react'

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: 'development',
  enableLogs: true,
  sendDefaultPii: false,
  tracesSampleRate: 1,
  tunnel: '/api/e4c1f9a7',
})
