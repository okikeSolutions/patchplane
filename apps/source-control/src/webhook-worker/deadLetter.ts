import { Effect } from 'effect'
import {
  type Env,
  type QueueMessage,
  claimDeliveryProcessingMutation,
  deadLetterRetryDelaySeconds,
  envelopeIdentity,
  fetchBoundedJsonWithServiceBindingDeadline,
  getDeliveryReceiptQuery,
  validMessage,
  validSignature,
} from './boundary'
import {
  convexMutationCall,
  convexQueryCall,
  promiseCall,
  releaseProcessing,
  reportFailure,
} from './processingSupport'

export const processDeadLetterMessage = Effect.fnUntraced(function* (
  message: QueueMessage<unknown>,
  env: Env,
) {
  if (!validMessage(message.body)) {
    message.retry({ delaySeconds: deadLetterRetryDelaySeconds })
    return
  }
  const body = message.body
  if (
    !(yield* validSignature(
      body.payload,
      body.signature,
      env.GITHUB_WEBHOOK_SECRET,
    ))
  ) {
    message.retry({ delaySeconds: deadLetterRetryDelaySeconds })
    return
  }
  const processingToken = crypto.randomUUID()
  let processingClaimed = false
  yield* Effect.gen(function* () {
    const envelope = yield* envelopeIdentity(body)
    const receipt: unknown = yield* convexQueryCall(
      env,
      'convex.getDeliveryReceipt',
      getDeliveryReceiptQuery,
      {
        systemSecret: env.PATCHPLANE_SYSTEM_INGESTION_SECRET,
        deliveryId: body.deliveryId,
      },
    )
    if (receipt === null || typeof receipt !== 'object') {
      message.ack()
      return
    }
    const decodedReceipt = receipt as Record<string, unknown>
    if (
      decodedReceipt.envelopeStorageKey !== envelope.storageKey ||
      decodedReceipt.envelopeSha256 !== envelope.digest ||
      decodedReceipt.activeDeliveryToken !== body.deliveryToken
    ) {
      message.ack()
      return
    }
    if (decodedReceipt.status === 'terminal') {
      yield* promiseCall('r2.deleteWebhookEnvelope', () =>
        env.PATCHPLANE_EVIDENCE_BUCKET.delete(envelope.storageKey),
      )
      message.ack()
      return
    }
    const claim: unknown = yield* convexMutationCall(
      env,
      'convex.claimDeliveryProcessing',
      claimDeliveryProcessingMutation,
      {
        systemSecret: env.PATCHPLANE_SYSTEM_INGESTION_SECRET,
        deliveryId: body.deliveryId,
        deliveryToken: body.deliveryToken,
        processingToken,
      },
    )
    if (claim === 'busy') {
      message.retry({ delaySeconds: deadLetterRetryDelaySeconds })
      return
    }
    if (claim !== 'claimed') {
      message.ack()
      return
    }
    processingClaimed = true
    const bounded = yield* fetchBoundedJsonWithServiceBindingDeadline(
      env.SOURCE_CONTROL_WORKER,
      'https://source-control.internal/internal/queue/exhausted',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          deliveryId: body.deliveryId,
          deliveryToken: body.deliveryToken,
          processingToken,
        }),
      },
      30_000,
    )
    const decoded =
      bounded.body !== null && typeof bounded.body === 'object'
        ? (bounded.body as Record<string, unknown>)
        : undefined
    if (
      bounded.response.ok &&
      decoded?.ok === true &&
      decoded.terminalized === true &&
      (decoded.workflowRunId === undefined ||
        (typeof decoded.workflowRunId === 'string' &&
          decoded.workflowRunId.length > 0 &&
          decoded.workflowRunId.length <= 256))
    ) {
      yield* promiseCall('r2.deleteWebhookEnvelope', () =>
        env.PATCHPLANE_EVIDENCE_BUCKET.delete(envelope.storageKey),
      )
      message.ack()
    } else {
      yield* releaseProcessing(env, {
        deliveryId: body.deliveryId,
        deliveryToken: body.deliveryToken,
        processingToken,
      })
      processingClaimed = false
      message.retry({ delaySeconds: deadLetterRetryDelaySeconds })
    }
  }).pipe(
    Effect.catchCause(() =>
      Effect.gen(function* () {
        if (processingClaimed) {
          yield* releaseProcessing(env, {
            deliveryId: body.deliveryId,
            deliveryToken: body.deliveryToken,
            processingToken,
          }).pipe(Effect.ignore)
        }
        yield* reportFailure('github-webhook-worker.queue.service-binding')
        message.retry({ delaySeconds: deadLetterRetryDelaySeconds })
      }),
    ),
  )
})
