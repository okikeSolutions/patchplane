import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
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

async function sha256(bytes: Uint8Array) {
  return hex(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer),
    ),
  )
}

async function decodeStoredEnvelope(
  bytes: Uint8Array | undefined,
  expectedSha256: string,
): Promise<unknown> {
  if (bytes === undefined || (await sha256(bytes)) !== expectedSha256) {
    return undefined
  }
  try {
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    ) as unknown
  } catch {
    return undefined
  }
}

async function envelopeIdentity(message: GitHubWebhookEnvelope) {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      deliveryId: message.deliveryId,
      eventName: message.eventName,
      signature: message.signature,
      payload: message.payload,
    }),
  )
  const digest = await sha256(bytes)
  return {
    bytes,
    digest,
    storageKey: `webhook-queue/github/${message.deliveryId}/${digest}.json`,
  }
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false
  let mismatch = 0
  for (let index = 0; index < left.byteLength; index += 1) {
    mismatch |= (left[index] ?? 0) ^ (right[index] ?? 0)
  }
  return mismatch === 0
}

async function readBoundedPayload(request: Request) {
  const declaredLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxWebhookBytes) {
    return undefined
  }
  const reader = request.body?.getReader()
  if (reader === undefined) return ''
  const chunks: Array<Uint8Array> = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxWebhookBytes) {
      await reader.cancel()
      return undefined
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

const maxServiceBindingResponseBytes = 16 * 1024

async function fetchBoundedJsonWithServiceBindingDeadline(
  service: ServiceBinding,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs = (14 * 60 + 30) * 1_000,
): Promise<{ readonly response: Response; readonly body: unknown }> {
  const controller = new AbortController()
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      void reader?.cancel().catch(() => undefined)
      reject(new Error('Source-control service binding deadline exceeded'))
    }, timeoutMs)
  })
  const operation = async () => {
    const response = await service.fetch(input, {
      ...init,
      signal: controller.signal,
    })
    const contentType = response.headers.get('content-type') ?? ''
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
      throw new Error('Source-control service binding returned non-JSON content')
    }
    const contentLengthHeader = response.headers.get('content-length')
    if (contentLengthHeader !== null) {
      const contentLength = Number(contentLengthHeader)
      if (
        !Number.isSafeInteger(contentLength) ||
        contentLength < 0 ||
        contentLength > maxServiceBindingResponseBytes
      ) {
        throw new Error(
          'Source-control service binding response exceeded its byte limit',
        )
      }
    }
    reader = response.body?.getReader()
    const chunks: Array<Uint8Array> = []
    let size = 0
    if (reader !== undefined) {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > maxServiceBindingResponseBytes) {
          throw new Error(
            'Source-control service binding response exceeded its byte limit',
          )
        }
        chunks.push(value)
      }
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { response, body: JSON.parse(text) as unknown }
  }
  try {
    return await Promise.race([operation(), deadline])
  } catch (cause) {
    controller.abort()
    void reader?.cancel().catch(() => undefined)
    throw cause
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function validSignature(
  payload: string,
  signature: string,
  secret: string,
) {
  if (!/^sha256=[0-9a-f]{64}$/.test(signature) || secret.length === 0) {
    return false
  }
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const expected = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)),
  )
  const supplied = Uint8Array.from(
    signature.slice('sha256='.length).match(/../g) ?? [],
    (pair) => Number.parseInt(pair, 16),
  )
  return timingSafeEqual(expected, supplied)
}

const handler = {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url)

    if (request.method === 'POST' && url.pathname === '/api/github/webhook') {
      const deliveryId = request.headers.get('x-github-delivery') ?? ''
      const eventName = request.headers.get('x-github-event') ?? ''
      const signature = request.headers.get('x-hub-signature-256') ?? ''
      const payload = await readBoundedPayload(request)
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
        !(await validSignature(payload, signature, env.GITHUB_WEBHOOK_SECRET))
      ) {
        return Response.json(
          { ok: false, error: 'Invalid GitHub webhook' },
          { status: 401 },
        )
      }
      const envelope = await envelopeIdentity(message)
      const deliveryToken = crypto.randomUUID()
      const envelopeBytes = envelope.bytes
      const envelopeSha256 = envelope.digest
      const envelopeStorageKey = envelope.storageKey
      try {
        await env.PATCHPLANE_EVIDENCE_BUCKET.put(
          envelopeStorageKey,
          envelopeBytes,
          { httpMetadata: { contentType: 'application/json' } },
        )
        const recorded = await new ConvexHttpClient(env.CONVEX_URL).mutation(
          recordQueuedDeliveryMutation,
          {
            systemSecret: env.PATCHPLANE_SYSTEM_INGESTION_SECRET,
            deliveryId,
            envelopeStorageKey,
            envelopeSha256,
            deliveryToken,
          },
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
        await env.VERIFICATION_EXECUTION_QUEUE.send({
          ...message,
          deliveryToken: persistedReceipt.deliveryToken,
        })
        return Response.json(
          { ok: true, queued: true, deliveryId },
          { status: 202 },
        )
      } catch {
        captureCloudflareRequestFailure('github-webhook-worker.queue.send')
        return Response.json(
          { ok: false, error: 'GitHub webhook queue unavailable' },
          { status: 502 },
        )
      }
    }

    return Response.json({ ok: false, error: 'Not found' }, { status: 404 })
  },

  async scheduled(_controller: unknown, env: Env) {
    const client = new ConvexHttpClient(env.CONVEX_URL)
    const queued: unknown = await client.mutation(
      claimStaleDeliveriesMutation,
      {
        systemSecret: env.PATCHPLANE_SYSTEM_INGESTION_SECRET,
      },
    )
    if (!Array.isArray(queued) || queued.length > 32) {
      captureCloudflareRequestFailure('github-webhook-worker.queue.send')
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
      )
        continue
      try {
        const object = await env.PATCHPLANE_EVIDENCE_BUCKET.get(
          receipt.envelopeStorageKey,
        )
        const bytes =
          object === null || object.size > maxQueuedMessageBytes
            ? undefined
            : new Uint8Array(await object.arrayBuffer())
        const decoded = await decodeStoredEnvelope(
          bytes,
          receipt.envelopeSha256,
        )
        if (!validEnvelope(decoded)) {
          const processingToken = crypto.randomUUID()
          const claim: unknown = await client.mutation(
            claimDeliveryProcessingMutation,
            {
              systemSecret: env.PATCHPLANE_SYSTEM_INGESTION_SECRET,
              deliveryId: receipt.deliveryId,
              deliveryToken: receipt.deliveryToken,
              processingToken,
            },
          )
          if (claim === 'claimed') {
            const bounded = await fetchBoundedJsonWithServiceBindingDeadline(
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
            ).catch(() => undefined)
            const body = bounded?.body
            const terminalized =
              bounded?.response.ok === true &&
              body !== null &&
              typeof body === 'object' &&
              (body as Record<string, unknown>).terminalized === true
            if (terminalized) {
              await env.PATCHPLANE_EVIDENCE_BUCKET.delete(
                receipt.envelopeStorageKey,
              )
            } else {
              await client.mutation(releaseDeliveryProcessingMutation, {
                systemSecret: env.PATCHPLANE_SYSTEM_INGESTION_SECRET,
                deliveryId: receipt.deliveryId,
                deliveryToken: receipt.deliveryToken,
                processingToken,
              })
            }
          }
          continue
        }
        await env.VERIFICATION_EXECUTION_QUEUE.send({
          ...decoded,
          deliveryToken: receipt.deliveryToken,
        })
      } catch {
        captureCloudflareRequestFailure('github-webhook-worker.queue.send')
      }
    }
  },

  async queue(batch: QueueBatch<unknown>, env: Env) {
    for (const message of batch.messages) {
      if (batch.queue === env.VERIFICATION_DEAD_LETTER_QUEUE_NAME) {
        if (
          !validMessage(message.body) ||
          !(await validSignature(
            message.body.payload,
            message.body.signature,
            env.GITHUB_WEBHOOK_SECRET,
          ))
        ) {
          message.retry({ delaySeconds: deadLetterRetryDelaySeconds })
          continue
        }
        const processingToken = crypto.randomUUID()
        let processingClaimed = false
        try {
          const envelope = await envelopeIdentity(message.body)
          const client = new ConvexHttpClient(env.CONVEX_URL)
          const receipt: unknown = await client.query(getDeliveryReceiptQuery, {
            systemSecret: env.PATCHPLANE_SYSTEM_INGESTION_SECRET,
            deliveryId: message.body.deliveryId,
          })
          if (receipt === null || typeof receipt !== 'object') {
            message.ack()
            continue
          }
          const decodedReceipt = receipt as Record<string, unknown>
          if (
            decodedReceipt.envelopeStorageKey !== envelope.storageKey ||
            decodedReceipt.envelopeSha256 !== envelope.digest ||
            decodedReceipt.activeDeliveryToken !== message.body.deliveryToken
          ) {
            message.ack()
            continue
          }
          if (decodedReceipt.status === 'terminal') {
            await env.PATCHPLANE_EVIDENCE_BUCKET.delete(envelope.storageKey)
            message.ack()
            continue
          }
          const claim: unknown = await client.mutation(
            claimDeliveryProcessingMutation,
            {
              systemSecret: env.PATCHPLANE_SYSTEM_INGESTION_SECRET,
              deliveryId: message.body.deliveryId,
              deliveryToken: message.body.deliveryToken,
              processingToken,
            },
          )
          if (claim === 'busy') {
            message.retry({ delaySeconds: deadLetterRetryDelaySeconds })
            continue
          }
          if (claim !== 'claimed') {
            message.ack()
            continue
          }
          processingClaimed = true
          const bounded = await fetchBoundedJsonWithServiceBindingDeadline(
            env.SOURCE_CONTROL_WORKER,
            'https://source-control.internal/internal/queue/exhausted',
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                deliveryId: message.body.deliveryId,
                deliveryToken: message.body.deliveryToken,
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
            await env.PATCHPLANE_EVIDENCE_BUCKET.delete(envelope.storageKey)
            message.ack()
          } else {
            await client.mutation(releaseDeliveryProcessingMutation, {
              systemSecret: env.PATCHPLANE_SYSTEM_INGESTION_SECRET,
              deliveryId: message.body.deliveryId,
              deliveryToken: message.body.deliveryToken,
              processingToken,
            })
            processingClaimed = false
            message.retry({ delaySeconds: deadLetterRetryDelaySeconds })
          }
        } catch {
          if (processingClaimed) {
            await new ConvexHttpClient(env.CONVEX_URL)
              .mutation(releaseDeliveryProcessingMutation, {
                systemSecret: env.PATCHPLANE_SYSTEM_INGESTION_SECRET,
                deliveryId: message.body.deliveryId,
                deliveryToken: message.body.deliveryToken,
                processingToken,
              })
              .catch(() => undefined)
          }
          captureCloudflareRequestFailure(
            'github-webhook-worker.queue.service-binding',
          )
          message.retry({ delaySeconds: deadLetterRetryDelaySeconds })
        }
        continue
      }
      if (!validMessage(message.body)) {
        message.ack()
        continue
      }
      const processingToken = crypto.randomUUID()
      let processingClaimed = false
      try {
        const envelope = await envelopeIdentity(message.body)
        const client = new ConvexHttpClient(env.CONVEX_URL)
        const receipt: unknown = await client.query(getDeliveryReceiptQuery, {
          systemSecret: env.PATCHPLANE_SYSTEM_INGESTION_SECRET,
          deliveryId: message.body.deliveryId,
        })
        if (receipt === null || typeof receipt !== 'object') {
          message.ack()
          continue
        }
        const decodedReceipt = receipt as Record<string, unknown>
        if (
          decodedReceipt.envelopeStorageKey !== envelope.storageKey ||
          decodedReceipt.envelopeSha256 !== envelope.digest ||
          decodedReceipt.activeDeliveryToken !== message.body.deliveryToken
        ) {
          message.ack()
          continue
        }
        if (decodedReceipt.status === 'terminal') {
          await env.PATCHPLANE_EVIDENCE_BUCKET.delete(envelope.storageKey)
          message.ack()
          continue
        }
        if (decodedReceipt.status !== 'delivering') {
          message.ack()
          continue
        }
        const claim: unknown = await client.mutation(
          claimDeliveryProcessingMutation,
          {
            systemSecret: env.PATCHPLANE_SYSTEM_INGESTION_SECRET,
            deliveryId: message.body.deliveryId,
            deliveryToken: message.body.deliveryToken,
            processingToken,
          },
        )
        if (claim !== 'claimed') {
          message.ack()
          continue
        }
        processingClaimed = true
        const bounded = await fetchBoundedJsonWithServiceBindingDeadline(
          env.SOURCE_CONTROL_WORKER,
          'https://source-control.internal/api/github/webhook',
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-github-delivery': message.body.deliveryId,
              'x-github-event': message.body.eventName,
              'x-hub-signature-256': message.body.signature,
              'x-patchplane-queued-delivery': 'v1',
            },
            body: message.body.payload,
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
          decoded.deliveryId === message.body.deliveryId &&
          ((decoded.ignored === true && decoded.workflowRunId === undefined) ||
            (typeof decoded.workflowRunId === 'string' &&
              decoded.workflowRunId.length > 0 &&
              decoded.workflowRunId.length <= 256))
        if (terminal) {
          const completed = await new ConvexHttpClient(env.CONVEX_URL).mutation(
            completeQueuedDeliveryMutation,
            {
              systemSecret: env.PATCHPLANE_SYSTEM_INGESTION_SECRET,
              deliveryId: message.body.deliveryId,
              deliveryToken: message.body.deliveryToken,
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
            await env.PATCHPLANE_EVIDENCE_BUCKET.delete(envelope.storageKey)
            message.ack()
          } else {
            await client.mutation(releaseDeliveryProcessingMutation, {
              systemSecret: env.PATCHPLANE_SYSTEM_INGESTION_SECRET,
              deliveryId: message.body.deliveryId,
              deliveryToken: message.body.deliveryToken,
              processingToken,
            })
            processingClaimed = false
            message.retry({ delaySeconds: retryDelaySeconds })
          }
        } else {
          await client.mutation(releaseDeliveryProcessingMutation, {
            systemSecret: env.PATCHPLANE_SYSTEM_INGESTION_SECRET,
            deliveryId: message.body.deliveryId,
            deliveryToken: message.body.deliveryToken,
            processingToken,
          })
          processingClaimed = false
          message.retry({ delaySeconds: retryDelaySeconds })
        }
      } catch {
        if (processingClaimed) {
          await new ConvexHttpClient(env.CONVEX_URL)
            .mutation(releaseDeliveryProcessingMutation, {
              systemSecret: env.PATCHPLANE_SYSTEM_INGESTION_SECRET,
              deliveryId: message.body.deliveryId,
              deliveryToken: message.body.deliveryToken,
              processingToken,
            })
            .catch(() => undefined)
        }
        captureCloudflareRequestFailure(
          'github-webhook-worker.queue.service-binding',
        )
        message.retry({ delaySeconds: retryDelaySeconds })
      }
    }
  },
}

export default withCloudflareSentry({ ...handler })
