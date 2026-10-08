import { makeFunctionReference } from 'convex/server'
import { Effect, Option, Schema } from 'effect'
import { type CloudflareSentryEnv } from '@patchplane/plugins/sentry/cloudflare-worker'

export interface ServiceBinding {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

export interface GitHubWebhookEnvelope {
  readonly deliveryId: string
  readonly eventName: string
  readonly signature: string
  readonly payload: string
}

export interface QueuedGitHubWebhook extends GitHubWebhookEnvelope {
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

export interface QueueMessage<T> {
  readonly body: T
  ack(): void
  retry(options: { readonly delaySeconds: number }): void
}

export interface QueueBatch<T> {
  readonly queue: string
  readonly messages: ReadonlyArray<QueueMessage<T>>
}

export interface Env extends CloudflareSentryEnv {
  SOURCE_CONTROL_WORKER: ServiceBinding
  VERIFICATION_EXECUTION_QUEUE: QueueProducer
  GITHUB_WEBHOOK_SECRET: string
  CONVEX_URL: string
  PATCHPLANE_SYSTEM_INGESTION_SECRET: string
  VERIFICATION_DEAD_LETTER_QUEUE_NAME: string
  PATCHPLANE_EVIDENCE_BUCKET: WebhookEnvelopeBucket
}

const maxWebhookBytes = 48 * 1024
export const maxQueuedMessageBytes = 120 * 1024
export const retryDelaySeconds = 30
export const deadLetterRetryDelaySeconds = 3_600

export const recordQueuedDeliveryMutation = makeFunctionReference<
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
export const claimStaleDeliveriesMutation = makeFunctionReference<
  'mutation',
  { systemSecret: string },
  ReadonlyArray<{
    readonly deliveryId: string
    readonly envelopeStorageKey: string
    readonly envelopeSha256: string
    readonly deliveryToken: string
  }>
>('workflowStarts:claimStaleGitHubDeliveries')
export const getDeliveryReceiptQuery = makeFunctionReference<
  'query',
  { systemSecret: string; deliveryId: string },
  null | {
    readonly status: 'delivering' | 'terminal'
    readonly envelopeStorageKey: string
    readonly envelopeSha256: string
    readonly activeDeliveryToken: string
  }
>('workflowStarts:getGitHubDeliveryReceipt')
export const claimDeliveryProcessingMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    deliveryId: string
    deliveryToken: string
    processingToken: string
  },
  'claimed' | 'busy' | 'stale' | 'terminal'
>('workflowStarts:claimGitHubDeliveryProcessing')
export const releaseDeliveryProcessingMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    deliveryId: string
    deliveryToken: string
    processingToken: string
  },
  boolean
>('workflowStarts:releaseGitHubDeliveryProcessing')
export const completeQueuedDeliveryMutation = makeFunctionReference<
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

export function validEnvelope(value: unknown): value is GitHubWebhookEnvelope {
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

export function validMessage(value: unknown): value is QueuedGitHubWebhook {
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

class WebhookWorkerBoundaryError extends Schema.TaggedError<WebhookWorkerBoundaryError>()(
  'WebhookWorkerBoundaryError',
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export const boundaryError = (operation: string, cause: unknown) =>
  new WebhookWorkerBoundaryError({ operation, cause })

const sha256 = Effect.fnUntraced(function* (bytes: Uint8Array) {
  const digest = yield* Effect.tryPromise({
    try: () => crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer),
    catch: (cause) => boundaryError('crypto.sha256', cause),
  })
  return hex(new Uint8Array(digest))
})

export const decodeStoredEnvelope = Effect.fnUntraced(function* (
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

export const envelopeIdentity = Effect.fnUntraced(function* (
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

export const readBoundedStream = Effect.fnUntraced(function* (
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
        // A native cancel may wait on a pull that never settles; finalization must stay bounded.
        let cancellation: Promise<void> | undefined
        try {
          cancellation = ownedReader.cancel()
        } finally {
          ownedReader.releaseLock()
        }
        void cancellation?.catch(() => undefined)
      }),
  )
})

export const readBoundedPayload = Effect.fnUntraced(function* (
  request: Request,
) {
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

export const fetchBoundedJsonWithServiceBindingDeadline = Effect.fnUntraced(
  function* (
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
  },
)

export const validSignature = Effect.fnUntraced(function* (
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
