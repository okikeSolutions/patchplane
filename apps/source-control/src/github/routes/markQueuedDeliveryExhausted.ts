import { ConvexHttpClient } from 'convex/browser'
import { Exit, Redacted } from 'effect'
import { loadSourceControlRouteConfig, type WorkerEnv } from '../config'
import {
  readBoundedJson,
  type SourceControlRuntime,
  terminalizeQueuedGitHubDeliveryMutation,
  jsonResponse,
  configuredConvexUrl,
} from './support'

export async function markQueuedDeliveryExhausted(
  request: Request,
  env: WorkerEnv,
  runtime: SourceControlRuntime,
) {
  const input = await readBoundedJson(request)
  const fields =
    input !== null && typeof input === 'object'
      ? (input as Record<string, unknown>)
      : undefined
  const deliveryId =
    typeof fields?.deliveryId === 'string' ? fields.deliveryId : undefined
  const deliveryToken =
    typeof fields?.deliveryToken === 'string' ? fields.deliveryToken : undefined
  const processingToken =
    typeof fields?.processingToken === 'string'
      ? fields.processingToken
      : undefined
  if (
    deliveryId === undefined ||
    deliveryId.length === 0 ||
    deliveryId.length > 128 ||
    deliveryToken === undefined ||
    deliveryToken.length === 0 ||
    deliveryToken.length > 128 ||
    processingToken === undefined ||
    processingToken.length === 0 ||
    processingToken.length > 128
  ) {
    return jsonResponse(
      { ok: false, error: 'Invalid delivery identity' },
      { status: 400 },
    )
  }
  const configExit = await runtime.runPromiseExit(
    loadSourceControlRouteConfig(env),
  )
  if (Exit.isFailure(configExit)) {
    return jsonResponse(
      { ok: false, error: 'Source-control configuration is invalid' },
      { status: 500 },
    )
  }
  const secret = Redacted.value(configExit.value.systemIngestionSecret)
  if (secret.length === 0) {
    return jsonResponse(
      { ok: false, error: 'System ingestion is not configured' },
      { status: 500 },
    )
  }
  const terminal = await new ConvexHttpClient(
    configuredConvexUrl(configExit.value),
  ).mutation(terminalizeQueuedGitHubDeliveryMutation, {
    systemSecret: secret,
    deliveryId,
    deliveryToken,
    processingToken,
  })
  return jsonResponse({ ok: true, ...terminal }, { status: 200 })
}
