import { Effect } from 'effect'
import {
  type Env,
  type QueueMessage,
  claimDeliveryProcessingMutation,
  completeQueuedDeliveryMutation,
  envelopeIdentity,
  fetchBoundedJsonWithServiceBindingDeadline,
  getDeliveryReceiptQuery,
  retryDelaySeconds,
  validMessage,
} from './boundary'
import {
  convexMutationCall,
  convexQueryCall,
  promiseCall,
  releaseProcessing,
  reportFailure,
} from './processingSupport'

export const processPrimaryMessage = Effect.fnUntraced(function* (
  message: QueueMessage<unknown>,
  env: Env,
) {
  if (!validMessage(message.body)) {
    message.ack()
    return
  }
  const body = message.body
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
    if (decodedReceipt.status !== 'delivering') {
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
    if (claim !== 'claimed') {
      message.ack()
      return
    }
    processingClaimed = true
    const bounded = yield* fetchBoundedJsonWithServiceBindingDeadline(
      env.SOURCE_CONTROL_WORKER,
      'https://source-control.internal/api/github/webhook',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-github-delivery': body.deliveryId,
          'x-github-event': body.eventName,
          'x-hub-signature-256': body.signature,
          'x-patchplane-queued-delivery': 'v1',
        },
        body: body.payload,
      },
    )
    const decoded =
      bounded.body !== null && typeof bounded.body === 'object'
        ? (bounded.body as Record<string, unknown>)
        : undefined
    const terminal =
      bounded.response.status === 202 &&
      decoded?.ok === true &&
      decoded.verificationTerminal === true &&
      decoded.deliveryId === body.deliveryId &&
      ((decoded.ignored === true && decoded.workflowRunId === undefined) ||
        (typeof decoded.workflowRunId === 'string' &&
          decoded.workflowRunId.length > 0 &&
          decoded.workflowRunId.length <= 256))
    if (terminal) {
      const completed = yield* convexMutationCall(
        env,
        'convex.completeQueuedDelivery',
        completeQueuedDeliveryMutation,
        {
          systemSecret: env.PATCHPLANE_SYSTEM_INGESTION_SECRET,
          deliveryId: body.deliveryId,
          deliveryToken: body.deliveryToken,
          processingToken,
          ...(typeof decoded.workflowRunId === 'string'
            ? { workflowRunId: decoded.workflowRunId }
            : {}),
          outcome:
            decoded.deliveryCoalesced === true
              ? 'coalesced'
              : decoded.ignored === true
                ? 'ignored'
                : 'completed',
        },
      )
      if (completed === true) {
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
        message.retry({ delaySeconds: retryDelaySeconds })
      }
    } else {
      yield* releaseProcessing(env, {
        deliveryId: body.deliveryId,
        deliveryToken: body.deliveryToken,
        processingToken,
      })
      processingClaimed = false
      message.retry({ delaySeconds: retryDelaySeconds })
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
        message.retry({ delaySeconds: retryDelaySeconds })
      }),
    ),
  )
})
