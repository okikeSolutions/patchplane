import {
  captureCloudflareRequestFailure,
  withCloudflareSentry,
  type CloudflareSentryEnv,
} from '@patchplane/plugins/sentry/cloudflare-worker'
import type { WorkerEnv } from './github/config'
import {
  controlRuntimeSession,
  executeWorkflowRerun,
  handleGitHubWebhook,
  makeSourceControlRuntime,
  publishDecision,
  syncGitHubInstallation,
} from './github/routes'

interface RequestContext {
  waitUntil(promise: Promise<unknown>): void
}

function jsonResponse(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(body), { ...init, headers })
}

export default withCloudflareSentry({
  async fetch(
    request: Request,
    env: WorkerEnv & CloudflareSentryEnv,
    context: RequestContext,
  ) {
    const url = new URL(request.url)
    const runtime = makeSourceControlRuntime(env)

    try {
      if (
        request.method === 'POST' &&
        url.pathname === '/internal/github/install/sync'
      ) {
        return await syncGitHubInstallation(request, runtime)
      }

      if (
        request.method === 'POST' &&
        url.pathname === '/internal/runtime/control'
      ) {
        return await controlRuntimeSession(request, runtime)
      }

      if (
        request.method === 'POST' &&
        url.pathname === '/internal/workflow/rerun'
      ) {
        return await executeWorkflowRerun(request, env, runtime)
      }

      if (
        request.method === 'POST' &&
        url.pathname === '/internal/decision/publish'
      ) {
        return await publishDecision(request, env, runtime)
      }

      if (request.method === 'POST' && url.pathname === '/api/github/webhook') {
        return await handleGitHubWebhook(request, env, runtime)
      }

      return jsonResponse({ ok: false, error: 'Not found' }, { status: 404 })
    } catch {
      captureCloudflareRequestFailure('source-control.worker.fetch')
      return jsonResponse(
        { ok: false, error: 'Source-control request failed' },
        { status: 500 },
      )
    } finally {
      context.waitUntil(runtime.dispose())
    }
  },
})
