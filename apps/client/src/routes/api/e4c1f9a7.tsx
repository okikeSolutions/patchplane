import * as Sentry from '@sentry/tanstackstart-react'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/e4c1f9a7')({
  server: Sentry.createSentryTunnelRoute({
    allowedDsns: import.meta.env.VITE_SENTRY_DSN === undefined
      ? []
      : [import.meta.env.VITE_SENTRY_DSN],
  }),
})
