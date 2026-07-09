import { describe, expect, it } from '@effect/vitest'
import { ConfigProvider, Effect, Exit, Layer } from 'effect'
import { NodeCrypto } from '@effect/platform-node'
import { ArtifactsService } from '@patchplane/core/services/artifacts-service'
import { CloudflareR2ArtifactsPlugin, type R2BucketLike, type R2ObjectLike } from './R2ArtifactsPlugin'

class FakeBucket implements R2BucketLike {
  readonly objects = new Map<string, { body: Uint8Array; options: unknown; object: R2ObjectLike }>()
  failPut = false

  async put(key: string, value: Uint8Array, options?: unknown) {
    if (this.failPut) throw new Error('put failed')
    const object = {
      key,
      size: value.byteLength,
      uploaded: new Date(1700000000000),
      httpMetadata: { contentType: options && typeof options === 'object' && 'httpMetadata' in options ? (options as any).httpMetadata.contentType : undefined },
      customMetadata: options && typeof options === 'object' && 'customMetadata' in options ? (options as any).customMetadata : undefined,
    }
    this.objects.set(key, { body: value, options, object })
    return object
  }

  async head(key: string) {
    return this.objects.get(key)?.object ?? null
  }

  async delete(keys: string | string[]) {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key)
  }
}

function layer(bucket: FakeBucket, options: {
  readonly includeSigningCredentials?: boolean
} = {}) {
  const includeSigningCredentials = options.includeSigningCredentials ?? true
  return CloudflareR2ArtifactsPlugin.layerFromBucket(bucket).pipe(
    Layer.provide(NodeCrypto.layer),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({
      env: {
        CLOUDFLARE_ACCOUNT_ID: '123456789abcdef0123456789abcdef',
        PATCHPLANE_EVIDENCE_R2_BUCKET: 'patchplane-dev-evidence-artifacts',
        ...(includeSigningCredentials
          ? {
              PATCHPLANE_EVIDENCE_R2_ACCESS_KEY_ID: 'access-key',
              PATCHPLANE_EVIDENCE_R2_SECRET_ACCESS_KEY: 'secret-key',
            }
          : {}),
      },
    }))),
  )
}

describe('CloudflareR2ArtifactsPlugin', () => {
  it.effect('uploads artifact bytes and returns provider metadata', () => {
    const bucket = new FakeBucket()
    return Effect.gen(function* () {
      const artifacts = yield* ArtifactsService
      const metadata = yield* artifacts.putArtifact({
        workflowRunId: 'run_123',
        traceId: 'trace_123',
        kind: 'stdout',
        contentType: 'text/plain',
        body: 'hello artifact',
      })

      expect(metadata.storageProvider).toBe('cloudflare-r2')
      expect(metadata.storageKey).toMatch(/^workflows\/run_123\/stdout\/.+\.txt$/)
      expect(metadata.sizeBytes).toBe(14)
      expect(metadata.sha256).toBe('d1cc3064379fca32757730461bd728cb7de430e46a0046aa59ab55c65be7ce3b')
      expect(bucket.objects.get(metadata.storageKey)?.object.customMetadata).toMatchObject({
        workflowRunId: 'run_123',
        traceId: 'trace_123',
        kind: 'stdout',
        sha256: metadata.sha256,
      })
    }).pipe(Effect.provide(layer(bucket)))
  })

  it.effect('creates a presigned R2 read URL for a storage key', () =>
    Effect.gen(function* () {
      const artifacts = yield* ArtifactsService
      const signed = yield* artifacts.createSignedReadUrl({
        storageKey: 'workflows/run_123/stdout/log.txt',
        expiresInSeconds: 900,
      })
      const url = new URL(signed.url)
      expect(url.host).toBe('patchplane-dev-evidence-artifacts.123456789abcdef0123456789abcdef.r2.cloudflarestorage.com')
      expect(url.searchParams.get('X-Amz-Expires')).toBe('900')
      expect(url.searchParams.has('X-Amz-Signature')).toBe(true)
    }).pipe(Effect.provide(layer(new FakeBucket()))))

  it.effect('uploads artifacts with only a native R2 bucket binding and no S3 signing credentials', () => {
    const bucket = new FakeBucket()
    return Effect.gen(function* () {
      const artifacts = yield* ArtifactsService
      const metadata = yield* artifacts.putArtifact({
        workflowRunId: 'run_123',
        kind: 'stdout',
        contentType: 'text/plain',
        body: 'native binding only',
      })

      expect(metadata.storageKey).toMatch(/^workflows\/run_123\/stdout\/.+\.txt$/)
      expect(bucket.objects.has(metadata.storageKey)).toBe(true)
    }).pipe(Effect.provide(layer(bucket, { includeSigningCredentials: false })))
  })

  it.effect('fails signed URL creation clearly when signing credentials are not configured', () =>
    Effect.gen(function* () {
      const artifacts = yield* ArtifactsService
      const exit = yield* Effect.exit(artifacts.createSignedReadUrl({
        storageKey: 'workflows/run_123/stdout/log.txt',
        expiresInSeconds: 900,
      }))

      expect(Exit.isFailure(exit)).toBe(true)
      expect(String(exit)).toContain('required to create signed artifact URLs')
    }).pipe(Effect.provide(layer(new FakeBucket(), { includeSigningCredentials: false }))))

  it.effect('maps put failures to ArtifactsError', () => {
    const bucket = new FakeBucket()
    bucket.failPut = true
    return Effect.gen(function* () {
      const artifacts = yield* ArtifactsService
      const exit = yield* Effect.exit(artifacts.putArtifact({
        workflowRunId: 'run_123',
        kind: 'stdout',
        contentType: 'text/plain',
        body: 'hello',
      }))
      expect(Exit.isFailure(exit)).toBe(true)
    }).pipe(Effect.provide(layer(bucket)))
  })
})
