import { controlRuntimeSession, handleGitHubWebhook, syncGitHubInstallation } from './github/routes'

function jsonResponse(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(body), { ...init, headers })
}

export default {
  async fetch(request: Request) {
    const url = new URL(request.url)

    if (request.method === 'POST' && url.pathname === '/internal/github/install/sync') {
      return await syncGitHubInstallation(request)
    }

    if (request.method === 'POST' && url.pathname === '/internal/runtime/control') {
      return await controlRuntimeSession(request)
    }

    if (request.method === 'POST' && url.pathname === '/api/github/webhook') {
      return await handleGitHubWebhook(request)
    }

    return jsonResponse({ ok: false, error: 'Not found' }, { status: 404 })
  },
}
