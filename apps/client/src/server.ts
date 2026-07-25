import { withCloudflareSentry, type CloudflareSentryEnv } from '@patchplane/plugins/sentry/cloudflare-worker'
import { wrapFetchWithSentry } from '@sentry/tanstackstart-react'
import handler from '@tanstack/react-start/server-entry'
import { paraglideMiddleware } from './paraglide/server'

type ClientWorkerEnv = CloudflareSentryEnv & {
  readonly PATCHPLANE_DEBUG_LOGGING?: boolean | string
}

function enabled(value: boolean | string | undefined) {
  return value === true || value === 'true'
}

const tanstackHandler = wrapFetchWithSentry({
  fetch(request: Request): Promise<Response> {
    return paraglideMiddleware(request, () => handler.fetch(request))
  },
})

const clientHandler = {
  async fetch(request: Request, env?: ClientWorkerEnv): Promise<Response> {
    const debug = enabled(
      env?.PATCHPLANE_DEBUG_LOGGING ?? process.env.PATCHPLANE_DEBUG_LOGGING,
    )
    const startedAt = performance.now()
    const { pathname } = new URL(request.url)
    const requestId = request.headers.get('cf-ray') ?? crypto.randomUUID()

    if (debug) {
      console.debug({
        message: 'patchplane.client.request.started',
        event: 'patchplane.client.request.started',
        requestId,
        method: request.method,
        pathname,
      })
    }

    try {
      const response = await tanstackHandler.fetch(request)

      if (debug) {
        console.debug({
          message: 'patchplane.client.request.completed',
          event: 'patchplane.client.request.completed',
          requestId,
          method: request.method,
          pathname,
          status: response.status,
          durationMs: Math.round(performance.now() - startedAt),
        })
      }

      return response
    } catch (error) {
      console.error({
        message: 'patchplane.client.request.failed',
        event: 'patchplane.client.request.failed',
        requestId,
        method: request.method,
        pathname,
        durationMs: Math.round(performance.now() - startedAt),
        errorName: error instanceof Error ? error.name : 'UnknownError',
        errorMessage: error instanceof Error ? error.message : 'Unknown client Worker failure',
      })
      throw error
    }
  },
} satisfies ExportedHandler<ClientWorkerEnv>

export default withCloudflareSentry(clientHandler)
