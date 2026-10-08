import { createFileRoute } from '@tanstack/react-router'
import { forwardSentryTunnelEnvelope } from '@/lib/sentry-tunnel'

export const Route = createFileRoute('/api/e4c1f9a7')({
  server: {
    handlers: {
      POST: ({ request }) =>
        forwardSentryTunnelEnvelope(request, import.meta.env.VITE_SENTRY_DSN),
    },
  },
})
