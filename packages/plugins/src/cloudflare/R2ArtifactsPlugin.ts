import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { ArtifactsService, type ArtifactBody, type EvidenceArtifactKind } from '@patchplane/core/services/artifacts-service'
import { ArtifactsError } from '@patchplane/domain/errors'
import { Config, Crypto, Effect, Encoding, Layer, Option, Redacted } from 'effect'
import { R2ArtifactsConfig, type R2ArtifactsConfig as R2ArtifactsConfigType } from './R2ArtifactsConfig'

export interface R2ObjectLike {
  readonly key: string
  readonly size: number
  readonly uploaded?: Date | undefined
  readonly httpMetadata?: { readonly contentType?: string | undefined } | undefined
  readonly customMetadata?: Readonly<Record<string, string>> | undefined
}

export interface R2BucketLike {
  readonly put: (
    key: string,
    value: Uint8Array,
    options?: {
      readonly httpMetadata?: { readonly contentType?: string | undefined }
      readonly customMetadata?: Readonly<Record<string, string>>
      readonly sha256?: Uint8Array
    },
  ) => Promise<R2ObjectLike>
  readonly head: (key: string) => Promise<R2ObjectLike | null>
  readonly delete: (keys: string | string[]) => Promise<void>
}

const storageProvider = 'cloudflare-r2' as const

async function normalizeBody(body: ArtifactBody, maxBytes: number): Promise<Uint8Array> {
  if (typeof body === 'string') {
    const bytes = new TextEncoder().encode(body)
    assertMaxBytes(bytes.byteLength, maxBytes)
    return bytes
  }

  if (body instanceof Uint8Array) {
    assertMaxBytes(body.byteLength, maxBytes)
    return body
  }

  const parts: Array<Uint8Array> = []
  let size = 0
  for await (const part of body) {
    size += part.byteLength
    assertMaxBytes(size, maxBytes)
    parts.push(part)
  }

  const bytes = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.byteLength
  }
  return bytes
}

function assertMaxBytes(size: number, maxBytes: number) {
  if (size > maxBytes) {
    throw new Error(`artifact exceeds maximum size of ${maxBytes} bytes`)
  }
}

function extensionForContentType(contentType: string) {
  switch (contentType) {
    case 'text/plain':
      return 'txt'
    case 'text/x-patch':
      return 'patch'
    case 'application/json':
      return 'json'
    case 'image/png':
      return 'png'
    case 'image/jpeg':
      return 'jpg'
    case 'video/webm':
      return 'webm'
    default:
      return 'bin'
  }
}

function sanitizePathSegment(value: string) {
  const sanitized = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return sanitized.length === 0 ? 'artifact' : sanitized
}

function storageKey(input: {
  readonly workflowRunId: string
  readonly kind: EvidenceArtifactKind
  readonly objectId: string
  readonly contentType: string
  readonly hint?: string | undefined
}) {
  const suffix = input.hint === undefined || input.hint.trim().length === 0
    ? `${input.objectId}.${extensionForContentType(input.contentType)}`
    : sanitizePathSegment(input.hint)

  return [
    'workflows',
    sanitizePathSegment(input.workflowRunId),
    input.kind,
    suffix,
  ].join('/')
}

function validateExpiresInSeconds(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > 604_800) {
    throw new Error('expiresInSeconds must be an integer from 1 to 604800')
  }
  return value
}

function metadataFromObject(object: R2ObjectLike) {
  const sha256 = object.customMetadata?.sha256
  if (sha256 === undefined) {
    return undefined
  }
  return {
    storageProvider,
    storageKey: object.key,
    contentType: object.httpMetadata?.contentType ?? 'application/octet-stream',
    sizeBytes: object.size,
    sha256,
    createdAt: object.uploaded?.getTime() ?? 0,
  }
}

function resolveR2EndpointAndBucket(config: R2ArtifactsConfigType) {
  const configuredEndpoint = Option.getOrElse(config.s3ApiEndpoint, () => `https://${config.accountId}.r2.cloudflarestorage.com`)
  const url = new URL(configuredEndpoint)
  const endpointBucket = url.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)[0]
  url.pathname = '/'
  url.search = ''
  url.hash = ''
  const bucketName = Option.getOrElse(config.bucketName, () => endpointBucket ?? '')
  if (bucketName.length === 0) {
    throw new Error('PATCHPLANE_EVIDENCE_R2_BUCKET is required when CLOUDFLARE_S3_API_ENDPOINT does not include a bucket path')
  }
  return { endpoint: url.toString().replace(/\/$/, ''), bucketName }
}

function makeS3Client(config: R2ArtifactsConfigType, input: {
  readonly accessKeyId: string
  readonly secretAccessKey: string
}) {
  const { endpoint } = resolveR2EndpointAndBucket(config)
  return new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
    },
  })
}

function requireSigningCredentials(config: R2ArtifactsConfigType) {
  if (Option.isNone(config.accessKeyId) || Option.isNone(config.secretAccessKey)) {
    return Effect.fail(new ArtifactsError({
      operation: 'r2.createSignedReadUrl.config',
      message: 'PATCHPLANE_EVIDENCE_R2_ACCESS_KEY_ID and PATCHPLANE_EVIDENCE_R2_SECRET_ACCESS_KEY are required to create signed artifact URLs',
      cause: undefined,
    }))
  }

  return Effect.succeed({
    accessKeyId: Redacted.value(config.accessKeyId.value),
    secretAccessKey: Redacted.value(config.secretAccessKey.value),
  })
}

export function makeR2ArtifactsService(
  bucket: R2BucketLike,
  config: R2ArtifactsConfigType,
  crypto: Crypto.Crypto,
) {
  return ArtifactsService.of({
    putArtifact: (input) =>
      Effect.gen(function* () {
        const objectId = yield* crypto.randomUUIDv7.pipe(
          Effect.mapError((cause) =>
            new ArtifactsError({
              operation: 'r2.putArtifact.objectId',
              message: 'Failed to generate artifact object id',
              cause,
            })
          ),
        )
        const bytes = yield* Effect.tryPromise({
          try: () => normalizeBody(input.body, config.maxArtifactBytes),
          catch: (cause) =>
            new ArtifactsError({
              operation: 'r2.putArtifact.normalize',
              message: 'Failed to normalize artifact body',
              cause,
            }),
        })
        const digest = yield* crypto.digest('SHA-256', bytes).pipe(
          Effect.mapError((cause) =>
            new ArtifactsError({
              operation: 'r2.putArtifact.sha256',
              message: 'Failed to hash artifact body',
              cause,
            })
          ),
        )
        const sha256 = Encoding.encodeHex(digest)
        const key = storageKey({
          workflowRunId: input.workflowRunId,
          kind: input.kind,
          objectId,
          contentType: input.contentType,
          hint: input.storageKeyHint,
        })
        const object = yield* Effect.tryPromise({
          try: () => bucket.put(key, bytes, {
            httpMetadata: { contentType: input.contentType },
            customMetadata: {
              workflowRunId: input.workflowRunId,
              ...(input.traceId === undefined ? {} : { traceId: input.traceId }),
              kind: input.kind,
              sha256,
              ...(input.retentionPolicy === undefined ? {} : { retentionPolicy: input.retentionPolicy }),
              ...input.metadata,
            },
            sha256: digest,
          }),
          catch: (cause) =>
            new ArtifactsError({
              operation: 'r2.putArtifact',
              message: 'Failed to upload artifact to R2',
              cause,
            }),
        })

        return {
          storageProvider,
          storageKey: object.key,
          contentType: input.contentType,
          sizeBytes: object.size,
          sha256,
          createdAt: Date.now(),
        }
      }),

    getArtifactMetadata: (input) =>
      Effect.gen(function* () {
        const object = yield* Effect.tryPromise({
          try: () => bucket.head(input.storageKey),
          catch: (cause) =>
            new ArtifactsError({
              operation: 'r2.getArtifactMetadata',
              message: 'Failed to read artifact metadata from R2',
              cause,
            }),
        })
        if (object === null) {
          return yield* new ArtifactsError({
            operation: 'r2.getArtifactMetadata.notFound',
            message: 'Artifact object not found in R2',
            cause: undefined,
          })
        }
        const metadata = metadataFromObject(object)
        if (metadata === undefined) {
          return yield* new ArtifactsError({
            operation: 'r2.getArtifactMetadata.sha256',
            message: 'Artifact object is missing sha256 metadata',
            cause: undefined,
          })
        }
        return metadata
      }),

    createSignedReadUrl: (input) =>
      Effect.gen(function* () {
        const credentials = yield* requireSigningCredentials(config)
        const s3 = makeS3Client(config, credentials)
        const { bucketName } = resolveR2EndpointAndBucket(config)
        return yield* Effect.tryPromise({
          try: async () => {
            const expiresIn = validateExpiresInSeconds(input.expiresInSeconds)
            const url = await getSignedUrl(
              s3,
              new GetObjectCommand({ Bucket: bucketName, Key: input.storageKey }),
              { expiresIn },
            )
            return { url, expiresAt: Date.now() + expiresIn * 1000 }
          },
        catch: (cause) =>
          new ArtifactsError({
            operation: 'r2.createSignedReadUrl',
            message: 'Failed to create signed R2 read URL',
            cause,
          }),
        })
      }),

    deleteArtifact: (input) =>
      Effect.tryPromise({
        try: () => bucket.delete(input.storageKey),
        catch: (cause) =>
          new ArtifactsError({
            operation: 'r2.deleteArtifact',
            message: 'Failed to delete artifact from R2',
            cause,
          }),
      }),

    applyRetentionPolicy: (input) =>
      Effect.gen(function* () {
        yield* Effect.logDebug('R2 artifact retention policy is enforced by bucket lifecycle rules', {
          storageKey: input.storageKey,
          retentionPolicy: input.retentionPolicy,
          pluginName: 'cloudflare-r2-artifacts',
          operation: 'r2.applyRetentionPolicy',
        })
        const object = yield* Effect.tryPromise({
          try: () => bucket.head(input.storageKey),
          catch: (cause) =>
            new ArtifactsError({
              operation: 'r2.applyRetentionPolicy.head',
              message: 'Failed to read artifact metadata from R2',
              cause,
            }),
        })
        if (object === null) {
          return yield* new ArtifactsError({
            operation: 'r2.applyRetentionPolicy.notFound',
            message: 'Artifact object not found in R2',
            cause: undefined,
          })
        }
        const metadata = metadataFromObject(object)
        if (metadata === undefined) {
          return yield* new ArtifactsError({
            operation: 'r2.applyRetentionPolicy.sha256',
            message: 'Artifact object is missing sha256 metadata',
            cause: undefined,
          })
        }
        return metadata
      }),
  })
}

export const CloudflareR2ArtifactsPlugin = {
  layerFromBucket: (bucket: R2BucketLike) =>
    Layer.effect(
      ArtifactsService,
      Effect.gen(function* () {
        const config = yield* R2ArtifactsConfig
        const crypto = yield* Crypto.Crypto
        return makeR2ArtifactsService(bucket, config, crypto)
      }),
    ),
  config: R2ArtifactsConfig,
} satisfies {
  readonly layerFromBucket: (bucket: R2BucketLike) => Layer.Layer<ArtifactsService, Config.ConfigError, Crypto.Crypto>
  readonly config: typeof R2ArtifactsConfig
}
