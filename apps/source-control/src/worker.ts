import {
  captureCloudflareRequestFailure,
  withCloudflareSentry,
  type CloudflareSentryEnv,
} from '@patchplane/plugins/sentry/cloudflare-worker'
import { Effect, type ManagedRuntime, type Scope } from 'effect'
import type { WorkerEnv } from './github/config'
import {
  controlRuntimeSession,
  executeWorkflowRerun,
  handleGitHubWebhook,
  makeSourceControlRuntime,
  markQueuedDeliveryExhausted,
  publishDecision,
  syncGitHubInstallation,
  type SourceControlRuntime,
} from './github/routes'

interface RequestContext {
  waitUntil(promise: Promise<unknown>): void
}

function jsonResponse(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(body), { ...init, headers })
}

export function runSourceControlEffect<A, E, R, ER>(
  request: Request,
  runtime: ManagedRuntime.ManagedRuntime<R, ER>,
  effect: Effect.Effect<A, E, R | Scope.Scope>,
) {
  return runtime.runPromise(Effect.scoped(effect), { signal: request.signal })
}

export function runRuntimeControlRoute(
  request: Request,
  runtime: SourceControlRuntime,
) {
  return runSourceControlEffect(
    request,
    runtime,
    controlRuntimeSession(request),
  )
}

export function runWorkflowRerunRoute(
  request: Request,
  env: WorkerEnv,
  runtime: SourceControlRuntime,
) {
  return runSourceControlEffect(
    request,
    runtime,
    executeWorkflowRerun(request, env),
  )
}

export function runGitHubWebhookRoute(
  request: Request,
  env: WorkerEnv,
  runtime: SourceControlRuntime,
) {
  return runSourceControlEffect(
    request,
    runtime,
    handleGitHubWebhook(request, env),
  )
}

export function runQueuedDeliveryExhaustedRoute(
  request: Request,
  env: WorkerEnv,
  runtime: SourceControlRuntime,
) {
  return runSourceControlEffect(
    request,
    runtime,
    markQueuedDeliveryExhausted(request, env),
  )
}

export function runPublishDecisionRoute(
  request: Request,
  env: WorkerEnv,
  runtime: SourceControlRuntime,
) {
  return runSourceControlEffect(request, runtime, publishDecision(request, env))
}

export function finalizeSourceControlRoute(
  route: Promise<Response>,
  runtime: Pick<SourceControlRuntime, 'dispose'>,
  context: RequestContext,
  captureFailure: (
    operation: 'source-control.worker.fetch',
  ) => void = captureCloudflareRequestFailure,
) {
  return route
    .catch(() => {
      captureFailure('source-control.worker.fetch')
      return jsonResponse(
        { ok: false, error: 'Source-control request failed' },
        { status: 500 },
      )
    })
    .finally(() => {
      context.waitUntil(runtime.dispose())
    })
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
        ? runQueuedDeliveryExhaustedRoute(request, env, runtime)
        : request.method === 'POST' &&
            url.pathname === '/internal/github/install/sync'
          ? runSourceControlEffect(
              request,
              runtime,
              syncGitHubInstallation(request),
            )
          : request.method === 'POST' &&
              url.pathname === '/internal/runtime/control'
            ? runRuntimeControlRoute(request, runtime)
            : request.method === 'POST' &&
                url.pathname === '/internal/workflow/rerun'
              ? runWorkflowRerunRoute(request, env, runtime)
              : request.method === 'POST' &&
                  url.pathname === '/internal/decision/publish'
                ? runPublishDecisionRoute(request, env, runtime)
                : request.method === 'POST' &&
                    url.pathname === '/api/github/webhook'
                  ? runGitHubWebhookRoute(request, env, runtime)
                  : Promise.resolve(
                      jsonResponse(
                        { ok: false, error: 'Not found' },
                        { status: 404 },
                      ),
                    )

    return finalizeSourceControlRoute(route, runtime, context)
  },
})
