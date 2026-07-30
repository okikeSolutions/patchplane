import { ConvexHttpClient } from 'convex/browser'
import { Effect, Option } from 'effect'
import {
  type Env,
  claimDeliveryProcessingMutation,
  claimStaleDeliveriesMutation,
  decodeStoredEnvelope,
  fetchBoundedJsonWithServiceBindingDeadline,
  maxQueuedMessageBytes,
  validEnvelope,
} from './boundary'
import {
  promiseCall,
  releaseProcessing,
  reportFailure,
} from './processingSupport'

export const handleScheduled = Effect.fnUntraced(function* (env: Env) {
  const client = new ConvexHttpClient(env.CONVEX_URL)
  const queued: unknown = yield* promiseCall(
    'convex.claimStaleGitHubDeliveries',
    () =>
      client.mutation(claimStaleDeliveriesMutation, {
        systemSecret: env.PATCHPLANE_SYSTEM_INGESTION_SECRET,
      }),
  )
  if (!Array.isArray(queued) || queued.length > 32) {
    yield* reportFailure('github-webhook-worker.queue.send')
    return
  }
  for (const value of queued) {
    if (value === null || typeof value !== 'object') continue
    const receipt = value as Record<string, unknown>
    if (
      typeof receipt.deliveryId !== 'string' ||
      typeof receipt.envelopeStorageKey !== 'string' ||
      typeof receipt.envelopeSha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(receipt.envelopeSha256) ||
      typeof receipt.deliveryToken !== 'string'
    ) {
      continue
    }
    yield* Effect.gen(function* () {
      const object = yield* promiseCall('r2.getWebhookEnvelope', () =>
        env.PATCHPLANE_EVIDENCE_BUCKET.get(
          receipt.envelopeStorageKey as string,
        ),
      )
      const bytes =
        object === null || object.size > maxQueuedMessageBytes
          ? undefined
          : new Uint8Array(
              yield* promiseCall('r2.readWebhookEnvelope', () =>
                object.arrayBuffer(),
              ),
            )
      const decoded = yield* decodeStoredEnvelope(
        bytes,
        receipt.envelopeSha256 as string,
      )
      if (!validEnvelope(decoded)) {
        const processingToken = crypto.randomUUID()
        const claim: unknown = yield* promiseCall(
          'convex.claimDeliveryProcessing',
          () =>
            client.mutation(claimDeliveryProcessingMutation, {
              systemSecret: env.PATCHPLANE_SYSTEM_INGESTION_SECRET,
              deliveryId: receipt.deliveryId as string,
              deliveryToken: receipt.deliveryToken as string,
              processingToken,
            }),
        )
        if (claim === 'claimed') {
          const boundedOption =
            yield* fetchBoundedJsonWithServiceBindingDeadline(
              env.SOURCE_CONTROL_WORKER,
              'https://source-control.internal/internal/queue/exhausted',
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  deliveryId: receipt.deliveryId,
                  deliveryToken: receipt.deliveryToken,
                  processingToken,
                }),
              },
              30_000,
            ).pipe(Effect.option)
          const bounded = Option.getOrUndefined(boundedOption)
          const body = bounded?.body
          const terminalized =
            bounded?.response.ok === true &&
            body !== null &&
            typeof body === 'object' &&
            (body as Record<string, unknown>).terminalized === true
          if (terminalized) {
            yield* promiseCall('r2.deleteWebhookEnvelope', () =>
              env.PATCHPLANE_EVIDENCE_BUCKET.delete(
                receipt.envelopeStorageKey as string,
              ),
            )
          } else {
            yield* releaseProcessing(env, {
              deliveryId: receipt.deliveryId as string,
              deliveryToken: receipt.deliveryToken as string,
              processingToken,
            })
          }
        }
        return
      }
      yield* promiseCall('queue.replayVerificationExecution', () =>
        env.VERIFICATION_EXECUTION_QUEUE.send({
          ...decoded,
          deliveryToken: receipt.deliveryToken as string,
        }),
      )
    }).pipe(
      Effect.catchCause(() =>
        reportFailure('github-webhook-worker.queue.send'),
      ),
    )
  }
})
