import { ConvexHttpClient } from 'convex/browser'
import { Effect } from 'effect'
import {
  type Env,
  envelopeIdentity,
  maxQueuedMessageBytes,
  readBoundedPayload,
  recordQueuedDeliveryMutation,
  validEnvelope,
  validSignature,
} from './boundary'
import { promiseCall, reportFailure } from './processingSupport'

export const handleFetch = Effect.fnUntraced(function* (
  request: Request,
  env: Env,
) {
  const url = new URL(request.url)
  if (request.method !== 'POST' || url.pathname !== '/api/github/webhook') {
    return Response.json({ ok: false, error: 'Not found' }, { status: 404 })
  }

  const deliveryId = request.headers.get('x-github-delivery') ?? ''
  const eventName = request.headers.get('x-github-event') ?? ''
  const signature = request.headers.get('x-hub-signature-256') ?? ''
  const payload = yield* readBoundedPayload(request)
  if (payload === undefined) {
    return Response.json(
      { ok: false, error: 'GitHub webhook exceeds queue bounds' },
      { status: 413 },
    )
  }
  const message = { deliveryId, eventName, signature, payload }
  if (
    !validEnvelope(message) ||
    new TextEncoder().encode(JSON.stringify(message)).byteLength >
      maxQueuedMessageBytes ||
    !(yield* validSignature(payload, signature, env.GITHUB_WEBHOOK_SECRET))
  ) {
    return Response.json(
      { ok: false, error: 'Invalid GitHub webhook' },
      { status: 401 },
    )
  }

  return yield* Effect.gen(function* () {
    const envelope = yield* envelopeIdentity(message)
    const deliveryToken = crypto.randomUUID()
    yield* promiseCall('r2.putWebhookEnvelope', () =>
      env.PATCHPLANE_EVIDENCE_BUCKET.put(envelope.storageKey, envelope.bytes, {
        httpMetadata: { contentType: 'application/json' },
      }),
    )
    const recorded: unknown = yield* promiseCall(
      'convex.recordQueuedGitHubDelivery',
      () =>
        new ConvexHttpClient(env.CONVEX_URL).mutation(
          recordQueuedDeliveryMutation,
          {
            systemSecret: env.PATCHPLANE_SYSTEM_INGESTION_SECRET,
            deliveryId,
            envelopeStorageKey: envelope.storageKey,
            envelopeSha256: envelope.digest,
            deliveryToken,
          },
        ),
    )
    const persistedReceipt =
      recorded !== null && typeof recorded === 'object'
        ? (recorded as Record<string, unknown>)
        : undefined
    if (
      persistedReceipt?.accepted !== true ||
      typeof persistedReceipt.deliveryToken !== 'string' ||
      persistedReceipt.deliveryToken.length === 0 ||
      persistedReceipt.deliveryToken.length > 128
    ) {
      return Response.json(
        { ok: false, error: 'GitHub webhook receipt was rejected' },
        { status: 500 },
      )
    }
    yield* promiseCall('queue.sendVerificationExecution', () =>
      env.VERIFICATION_EXECUTION_QUEUE.send({
        ...message,
        deliveryToken: persistedReceipt.deliveryToken as string,
      }),
    )
    return Response.json(
      { ok: true, queued: true, deliveryId },
      { status: 202 },
    )
  }).pipe(
    Effect.catchCause(() =>
      reportFailure('github-webhook-worker.queue.send').pipe(
        Effect.as(
          Response.json(
            { ok: false, error: 'GitHub webhook queue unavailable' },
            { status: 502 },
          ),
        ),
      ),
    ),
  )
})
