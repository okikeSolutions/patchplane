import type { WorkerEnv } from './github/config'
import { controlRuntimeSession, handleGitHubWebhook, makeSourceControlRuntime, publishDecision, syncGitHubInstallation } from './github/routes'

interface RequestContext {
  waitUntil(promise: Promise<unknown>): void
}

function jsonResponse(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(body), { ...init, headers })
}

export default {
  async fetch(request: Request, env: WorkerEnv, context: RequestContext) {
    const url = new URL(request.url)
    const runtime = makeSourceControlRuntime(env)

    try {
      if (request.method === 'POST' && url.pathname === '/internal/github/install/sync') {
        return await syncGitHubInstallation(request, runtime)
      }

      if (request.method === 'POST' && url.pathname === '/internal/runtime/control') {
        return await controlRuntimeSession(request, runtime)
      }

      if (request.method === 'POST' && url.pathname === '/internal/decision/publish') {
        return await publishDecision(request, runtime)
      }

      if (request.method === 'POST' && url.pathname === '/api/github/webhook') {
        return await handleGitHubWebhook(request, env, runtime)
      }

      return jsonResponse({ ok: false, error: 'Not found' }, { status: 404 })
    } finally {
      context.waitUntil(runtime.dispose())
    }
  },
}
