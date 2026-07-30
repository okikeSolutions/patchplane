import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { Effect, Option, Schema } from 'effect'
import { TelemetryService } from '@patchplane/core/services/telemetry-service'
import { CloudflareTelemetryPlugin } from '@patchplane/plugins/sentry/cloudflare-telemetry-plugin'
import {
  captureCloudflareRequestFailure,
  withCloudflareSentry,
  type CloudflareSentryEnv,
} from '@patchplane/plugins/sentry/cloudflare-worker'

interface ServiceBinding {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

interface GitHubWebhookEnvelope {
  readonly deliveryId: string
  readonly eventName: string
  readonly signature: string
  readonly payload: string
}

interface QueuedGitHubWebhook extends GitHubWebhookEnvelope {
  readonly deliveryToken: string
}

interface WebhookEnvelopeBucket {
  put(
    key: string,
    value: Uint8Array,
    options?: { readonly httpMetadata?: { readonly contentType?: string } },
  ): Promise<unknown>
  get(key: string): Promise<{
    readonly size: number
    arrayBuffer(): Promise<ArrayBuffer>
  } | null>
  delete(key: string): Promise<void>
}

interface QueueProducer {
  send(message: QueuedGitHubWebhook): Promise<void>
}

interface QueueMessage<T> {
  readonly body: T
  ack(): void
  retry(options: { readonly delaySeconds: number }): void
}

interface QueueBatch<T> {
  readonly queue: string
  readonly messages: ReadonlyArray<QueueMessage<T>>
}

interface Env extends CloudflareSentryEnv {
  SOURCE_CONTROL_WORKER: ServiceBinding
  VERIFICATION_EXECUTION_QUEUE: QueueProducer
  GITHUB_WEBHOOK_SECRET: string
  CONVEX_URL: string
  PATCHPLANE_SYSTEM_INGESTION_SECRET: string
  VERIFICATION_DEAD_LETTER_QUEUE_NAME: string
  PATCHPLANE_EVIDENCE_BUCKET: WebhookEnvelopeBucket
}

const maxWebhookBytes = 48 * 1024
const maxQueuedMessageBytes = 120 * 1024
const retryDelaySeconds = 30
const deadLetterRetryDelaySeconds = 3_600

const recordQueuedDeliveryMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    deliveryId: string
    envelopeStorageKey: string
    envelopeSha256: string
    deliveryToken: string
  },
  unknown
>('workflowStarts:recordQueuedGitHubDelivery')
const claimStaleDeliveriesMutation = makeFunctionReference<
  'mutation',
  { systemSecret: string },
  ReadonlyArray<{
    readonly deliveryId: string
    readonly envelopeStorageKey: string
    readonly envelopeSha256: string
    readonly deliveryToken: string
  }>
>('workflowStarts:claimStaleGitHubDeliveries')
const getDeliveryReceiptQuery = makeFunctionReference<
  'query',
  { systemSecret: string; deliveryId: string },
  null | {
    readonly status: 'delivering' | 'terminal'
    readonly envelopeStorageKey: string
    readonly envelopeSha256: string
    readonly activeDeliveryToken: string
  }
>('workflowStarts:getGitHubDeliveryReceipt')
const claimDeliveryProcessingMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    deliveryId: string
    deliveryToken: string
    processingToken: string
  },
  'claimed' | 'busy' | 'stale' | 'terminal'
>('workflowStarts:claimGitHubDeliveryProcessing')
const releaseDeliveryProcessingMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    deliveryId: string
    deliveryToken: string
    processingToken: string
  },
  boolean
>('workflowStarts:releaseGitHubDeliveryProcessing')
const completeQueuedDeliveryMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    deliveryId: string
    deliveryToken: string
    processingToken: string
    workflowRunId?: string
    outcome: 'completed' | 'ignored' | 'failed' | 'coalesced'
  },
  boolean
>('workflowStarts:completeQueuedGitHubDelivery')

function validEnvelope(value: unknown): value is GitHubWebhookEnvelope {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.deliveryId === 'string' &&
    candidate.deliveryId.length > 0 &&
    candidate.deliveryId.length <= 128 &&
    typeof candidate.eventName === 'string' &&
    candidate.eventName.length > 0 &&
    candidate.eventName.length <= 128 &&
    typeof candidate.signature === 'string' &&
    /^sha256=[0-9a-f]{64}$/.test(candidate.signature) &&
    typeof candidate.payload === 'string' &&
    new TextEncoder().encode(candidate.payload).byteLength <= maxWebhookBytes
  )
}

function validMessage(value: unknown): value is QueuedGitHubWebhook {
  if (!validEnvelope(value)) return false
  const deliveryToken = (
    value as GitHubWebhookEnvelope & {
      readonly deliveryToken?: unknown
    }
  ).deliveryToken
  return (
    typeof deliveryToken === 'string' &&
    deliveryToken.length > 0 &&
    deliveryToken.length <= 128
  )
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  )
}

class WebhookWorkerBoundaryError extends Schema.ErrorClass<WebhookWorkerBoundaryError>(
  'WebhookWorkerBoundaryError',
)({
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

const boundaryError = (operation: string, cause: unknown) =>
  new WebhookWorkerBoundaryError({ operation, cause })

const sha256 = Effect.fnUntraced(function* (bytes: Uint8Array) {
  const digest = yield* Effect.tryPromise({
    try: () => crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer),
    catch: (cause) => boundaryError('crypto.sha256', cause),
  })
  return hex(new Uint8Array(digest))
})

const decodeStoredEnvelope = Effect.fnUntraced(function* (
  bytes: Uint8Array | undefined,
  expectedSha256: string,
) {
  if (bytes === undefined || (yield* sha256(bytes)) !== expectedSha256) {
    return undefined
  }
  const decoded = yield* Effect.try({
    try: () =>
      JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      ) as unknown,
    catch: (cause) => boundaryError('webhook.decodeStoredEnvelope', cause),
  }).pipe(Effect.option)
  return Option.getOrUndefined(decoded)
})

const envelopeIdentity = Effect.fnUntraced(function* (
  message: GitHubWebhookEnvelope,
) {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      deliveryId: message.deliveryId,
      eventName: message.eventName,
      signature: message.signature,
      payload: message.payload,
    }),
  )
  const digest = yield* sha256(bytes)
  return {
    bytes,
    digest,
    storageKey: `webhook-queue/github/${message.deliveryId}/${digest}.json`,
  }
})

function timingSafeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false
  let mismatch = 0
  for (let index = 0; index < left.byteLength; index += 1) {
    mismatch |= (left[index] ?? 0) ^ (right[index] ?? 0)
  }
  return mismatch === 0
}

const streamReadDeadlineMs = 30_000

const readBoundedStream = Effect.fnUntraced(function* (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  limit: number,
  operation: string,
) {
  return yield* Effect.acquireUseRelease(
    Effect.succeed(reader),
    (ownedReader) =>
      Effect.gen(function* () {
        const chunks: Array<Uint8Array> = []
        let size = 0
        while (true) {
          const { done, value } = yield* Effect.tryPromise({
            try: () => ownedReader.read(),
            catch: (cause) => boundaryError(`${operation}.read`, cause),
          })
          if (done) break
          size += value.byteLength
          if (size > limit) return undefined
          chunks.push(value)
        }
        const bytes = new Uint8Array(size)
        let offset = 0
        for (const chunk of chunks) {
          bytes.set(chunk, offset)
          offset += chunk.byteLength
        }
        return bytes
      }).pipe(
        Effect.raceFirst(
          Effect.sleep(`${streamReadDeadlineMs} millis`).pipe(
            Effect.andThen(
              Effect.fail(
                boundaryError(
                  `${operation}.deadline`,
                  'Bounded stream read deadline exceeded',
                ),
              ),
            ),
          ),
        ),
      ),
    (ownedReader) =>
      Effect.sync(() => {
        void ownedReader.cancel().catch(() => undefined)
      }),
  )
})

const readBoundedPayload = Effect.fnUntraced(function* (request: Request) {
  const declaredLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxWebhookBytes) {
    return undefined
  }
  const reader = request.body?.getReader()
  if (reader === undefined) return ''
  const bytes = yield* readBoundedStream(
    reader,
    maxWebhookBytes,
    'webhook.readBoundedPayload',
  )
  if (bytes === undefined) return undefined
  const decoded = yield* Effect.try({
    try: () => new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    catch: (cause) => boundaryError('webhook.readBoundedPayload', cause),
  }).pipe(Effect.option)
  return Option.getOrUndefined(decoded)
})

const maxServiceBindingResponseBytes = 16 * 1024

const fetchBoundedJsonWithServiceBindingDeadline = Effect.fnUntraced(function* (
  service: ServiceBinding,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs = (14 * 60 + 30) * 1_000,
) {
  const operation = Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: (signal) => service.fetch(input, { ...init, signal }),
      catch: (cause) => boundaryError('serviceBinding.fetch', cause),
    })
    const contentType = response.headers.get('content-type') ?? ''
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
      return yield* boundaryError(
        'serviceBinding.contentType',
        'Source-control service binding returned non-JSON content',
      )
    }
    const contentLengthHeader = response.headers.get('content-length')
    if (contentLengthHeader !== null) {
      const contentLength = Number(contentLengthHeader)
      if (
        !Number.isSafeInteger(contentLength) ||
        contentLength < 0 ||
        contentLength > maxServiceBindingResponseBytes
      ) {
        return yield* boundaryError(
          'serviceBinding.contentLength',
          'Source-control service binding response exceeded its byte limit',
        )
      }
    }
    const reader = response.body?.getReader()
    const bytes =
      reader === undefined
        ? new Uint8Array()
        : yield* readBoundedStream(
            reader,
            maxServiceBindingResponseBytes,
            'serviceBinding.body',
          )
    if (bytes === undefined) {
      return yield* boundaryError(
        'serviceBinding.bodyLength',
        'Source-control service binding response exceeded its byte limit',
      )
    }
    const body = yield* Effect.try({
      try: () =>
        JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(bytes),
        ) as unknown,
      catch: (cause) => boundaryError('serviceBinding.decodeJson', cause),
    })
    return { response, body }
  })
  return yield* Effect.raceFirst(
    operation,
    Effect.sleep(`${timeoutMs} millis`).pipe(
      Effect.andThen(
        Effect.fail(
          boundaryError(
            'serviceBinding.deadline',
            'Source-control service binding deadline exceeded',
          ),
        ),
      ),
    ),
  )
})

const validSignature = Effect.fnUntraced(function* (
  payload: string,
  signature: string,
  secret: string,
) {
  if (!/^sha256=[0-9a-f]{64}$/.test(signature) || secret.length === 0) {
    return false
  }
  const key = yield* Effect.tryPromise({
    try: () =>
      crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      ),
    catch: (cause) => boundaryError('crypto.importWebhookKey', cause),
  })
  const expected = new Uint8Array(
    yield* Effect.tryPromise({
      try: () =>
        crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)),
      catch: (cause) => boundaryError('crypto.signWebhookPayload', cause),
    }),
  )
  const supplied = Uint8Array.from(
    signature.slice('sha256='.length).match(/../g) ?? [],
    (pair) => Number.parseInt(pair, 16),
  )
  return timingSafeEqual(expected, supplied)
})

const reportFailure = (
  operation: Parameters<typeof captureCloudflareRequestFailure>[0],
) => Effect.sync(() => captureCloudflareRequestFailure(operation))

const promiseCall = <A>(operation: string, call: () => Promise<A>) =>
  Effect.tryPromise({
    try: call,
    catch: (cause) => boundaryError(operation, cause),
  })

const releaseProcessing = (
  env: Env,
  input: {
    readonly deliveryId: string
    readonly deliveryToken: string
    readonly processingToken: string
  },
) =>
  promiseCall('convex.releaseDeliveryProcessing', () =>
    new ConvexHttpClient(env.CONVEX_URL).mutation(
      releaseDeliveryProcessingMutation,
      {
        systemSecret: env.PATCHPLANE_SYSTEM_INGESTION_SECRET,
        ...input,
      },
    ),
  )

const handleFetch = Effect.fnUntraced(function* (request: Request, env: Env) {
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

const handleScheduled = Effect.fnUntraced(function* (env: Env) {
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

const processDeadLetterMessage = Effect.fnUntraced(function* (
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
    const client = new ConvexHttpClient(env.CONVEX_URL)
    const receipt: unknown = yield* promiseCall(
      'convex.getDeliveryReceipt',
      () =>
        client.query(getDeliveryReceiptQuery, {
          systemSecret: env.PATCHPLANE_SYSTEM_INGESTION_SECRET,
          deliveryId: body.deliveryId,
        }),
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
    const claim: unknown = yield* promiseCall(
      'convex.claimDeliveryProcessing',
      () =>
        client.mutation(claimDeliveryProcessingMutation, {
          systemSecret: env.PATCHPLANE_SYSTEM_INGESTION_SECRET,
          deliveryId: body.deliveryId,
          deliveryToken: body.deliveryToken,
          processingToken,
        }),
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

const processPrimaryMessage = Effect.fnUntraced(function* (
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
    const client = new ConvexHttpClient(env.CONVEX_URL)
    const receipt: unknown = yield* promiseCall(
      'convex.getDeliveryReceipt',
      () =>
        client.query(getDeliveryReceiptQuery, {
          systemSecret: env.PATCHPLANE_SYSTEM_INGESTION_SECRET,
          deliveryId: body.deliveryId,
        }),
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
    const claim: unknown = yield* promiseCall(
      'convex.claimDeliveryProcessing',
      () =>
        client.mutation(claimDeliveryProcessingMutation, {
          systemSecret: env.PATCHPLANE_SYSTEM_INGESTION_SECRET,
          deliveryId: body.deliveryId,
          deliveryToken: body.deliveryToken,
          processingToken,
        }),
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
      const completed = yield* promiseCall(
        'convex.completeQueuedDelivery',
        () =>
          new ConvexHttpClient(env.CONVEX_URL).mutation(
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
          ),
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

const handleQueue = Effect.fnUntraced(function* (
  batch: QueueBatch<unknown>,
  env: Env,
) {
  for (const message of batch.messages) {
    if (batch.queue === env.VERIFICATION_DEAD_LETTER_QUEUE_NAME) {
      yield* processDeadLetterMessage(message, env)
    } else {
      yield* processPrimaryMessage(message, env)
    }
  }
})

function runObservedWorkerEffect<A, E>(
  name: string,
  effect: Effect.Effect<A, E>,
) {
  return Effect.runPromise(
    TelemetryService.pipe(
      Effect.flatMap((telemetry) =>
        telemetry.withSpan({ name, operation: name }, effect),
      ),
      Effect.provide(CloudflareTelemetryPlugin.layer),
    ),
  )
}

const handler = {
  fetch(request: Request, env: Env) {
    return runObservedWorkerEffect(
      'source-control.webhook.fetch',
      handleFetch(request, env),
    )
  },
  scheduled(_controller: unknown, env: Env) {
    return runObservedWorkerEffect(
      'source-control.webhook.scheduled',
      handleScheduled(env).pipe(
        Effect.catchCause(() =>
          reportFailure('github-webhook-worker.queue.send'),
        ),
      ),
    )
  },
  queue(batch: QueueBatch<unknown>, env: Env) {
    return runObservedWorkerEffect(
      'source-control.webhook.queue',
      handleQueue(batch, env),
    )
  },
}

export default withCloudflareSentry({ ...handler })
