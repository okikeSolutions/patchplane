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
  markQueuedDeliveryExhausted,
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
  fetch(
    request: Request,
    env: WorkerEnv & CloudflareSentryEnv,
    context: RequestContext,
  ) {
    const url = new URL(request.url)
    const runtime = makeSourceControlRuntime(env)
    const route =
      request.method === 'POST' && url.pathname === '/internal/queue/exhausted'
        ? markQueuedDeliveryExhausted(request, env, runtime)
        : request.method === 'POST' &&
            url.pathname === '/internal/github/install/sync'
          ? syncGitHubInstallation(request, runtime)
          : request.method === 'POST' &&
              url.pathname === '/internal/runtime/control'
            ? controlRuntimeSession(request, runtime)
            : request.method === 'POST' &&
                url.pathname === '/internal/workflow/rerun'
              ? executeWorkflowRerun(request, env, runtime)
              : request.method === 'POST' &&
                  url.pathname === '/internal/decision/publish'
                ? publishDecision(request, env, runtime)
                : request.method === 'POST' &&
                    url.pathname === '/api/github/webhook'
                  ? handleGitHubWebhook(request, env, runtime)
                  : Promise.resolve(
                      jsonResponse(
                        { ok: false, error: 'Not found' },
                        { status: 404 },
                      ),
                    )

    return route
      .catch(() => {
        captureCloudflareRequestFailure('source-control.worker.fetch')
        return jsonResponse(
          { ok: false, error: 'Source-control request failed' },
          { status: 500 },
        )
      })
      .finally(() => {
        context.waitUntil(runtime.dispose())
      })
  },
})
