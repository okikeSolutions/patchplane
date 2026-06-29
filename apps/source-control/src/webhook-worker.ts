interface ServiceBinding {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

interface Env {
  SOURCE_CONTROL_WORKER: ServiceBinding
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url)

    if (request.method === 'POST' && url.pathname === '/api/github/webhook') {
      return await env.SOURCE_CONTROL_WORKER.fetch(request)
    }

    return Response.json({ ok: false, error: 'Not found' }, { status: 404 })
  },
}
