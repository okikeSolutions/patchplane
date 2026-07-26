import {
  captureCloudflareRequestFailure,
  withCloudflareSentry,
  type CloudflareSentryEnv,
} from '@patchplane/plugins/sentry/cloudflare-worker'

interface ServiceBinding {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

interface Env extends CloudflareSentryEnv {
  SOURCE_CONTROL_WORKER: ServiceBinding
}

export default withCloudflareSentry({
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url)

    if (request.method === 'POST' && url.pathname === '/api/github/webhook') {
      try {
        return await env.SOURCE_CONTROL_WORKER.fetch(request)
      } catch {
        captureCloudflareRequestFailure(
          'github-webhook-worker.service-binding.fetch',
        )
        return Response.json(
          { ok: false, error: 'Source-control Worker unavailable' },
          { status: 502 },
        )
      }
    }

    return Response.json({ ok: false, error: 'Not found' }, { status: 404 })
  },
})
