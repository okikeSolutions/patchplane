import { Schema } from 'effect'
import { describe, expect, test, vi } from 'vitest'
import { EvidenceArtifactStorageRecord } from '@patchplane/domain/evidence-artifact'
import {
  makeEvidenceArtifactId,
  makeWorkflowRunId,
} from '@patchplane/domain/ids'
import {
  artifactPreviewLimitBytes,
  createArtifactStorageResponse,
  type ArtifactReadBucket,
  type ArtifactReadObject,
} from './artifact-storage-response'

const artifact = {
  id: makeEvidenceArtifactId('artifact_123'),
  workflowRunId: makeWorkflowRunId('workflow_123'),
  storageKey: 'workflows/workflow_123/diff/artifact.patch',
  contentType: 'text/x-patch',
  createdAt: Date.UTC(2026, 6, 1),
  retentionPolicy: 'alpha-14d',
  sizeBytes: 12,
  sha256: Schema.decodeUnknownSync(EvidenceArtifactStorageRecord.fields.sha256)(
    'a'.repeat(64),
  ),
}

function objectWithBytes(bytes: Uint8Array): ArtifactReadObject {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return {
    size: bytes.byteLength,
    customMetadata: { sha256: artifact.sha256 },
    body: new Blob([buffer]).stream(),
    arrayBuffer: async () => buffer.slice(0),
  }
}

function bucketReturning(object: ArtifactReadObject | null) {
  const get = vi.fn<ArtifactReadBucket['get']>().mockResolvedValue(object)
  return { bucket: { get }, get }
}

describe('artifact storage response', () => {
  test('reads a bounded text preview through the native bucket binding', async () => {
    const previewObject = {
      ...objectWithBytes(new TextEncoder().encode('diff --git')),
      size: artifactPreviewLimitBytes + 1,
    }
    const { bucket, get } = bucketReturning(previewObject)

    const response = await createArtifactStorageResponse({
      artifact: { ...artifact, sizeBytes: previewObject.size },
      bucket,
      requestUrl: new URL(
        'https://app.example/api/artifacts/url?artifactId=artifact_123&preview=1',
      ),
    })

    expect(get).toHaveBeenCalledWith(artifact.storageKey, {
      range: { offset: 0, length: artifactPreviewLimitBytes },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(
      'text/plain; charset=utf-8',
    )
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-patchplane-preview-truncated')).toBe('true')
    expect(response.headers.get('x-patchplane-artifact-sha256')).toBe(
      artifact.sha256,
    )
    expect(response.headers.get('x-patchplane-artifact-size')).toBe(
      String(previewObject.size),
    )
    expect(response.headers.get('x-patchplane-preview-bytes')).toBe('10')
    expect(await response.text()).toBe('diff --git')
  })

  test('rejects binary inline previews', async () => {
    const { bucket } = bucketReturning(
      objectWithBytes(new Uint8Array([1, 0, 2])),
    )
    const response = await createArtifactStorageResponse({
      artifact: { ...artifact, sizeBytes: 3 },
      bucket,
      requestUrl: new URL(
        'https://app.example/api/artifacts/url?artifactId=artifact_123&preview=1',
      ),
    })

    expect(response.status).toBe(415)
    expect(await response.json()).toEqual({
      ok: false,
      code: 'binary_artifact',
      error: 'Binary artifacts cannot be previewed inline',
    })
  })

  test('distinguishes a retained object that is unexpectedly missing', async () => {
    const { bucket } = bucketReturning(null)
    const response = await createArtifactStorageResponse({
      artifact,
      bucket,
      now: artifact.createdAt + 7 * 24 * 60 * 60 * 1_000,
      requestUrl: new URL(
        'https://app.example/api/artifacts/url?artifactId=artifact_123&preview=1',
      ),
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      ok: false,
      code: 'artifact_object_not_found',
      error: 'Artifact object not found',
    })
  })

  test('reports an object removed after its recorded retention window as expired', async () => {
    const { bucket } = bucketReturning(null)
    const response = await createArtifactStorageResponse({
      artifact,
      bucket,
      now: artifact.createdAt + 15 * 24 * 60 * 60 * 1_000,
      requestUrl: new URL(
        'https://app.example/api/artifacts/url?artifactId=artifact_123&preview=1',
      ),
    })

    expect(response.status).toBe(410)
    expect(await response.json()).toEqual({
      ok: false,
      code: 'artifact_expired',
      error: 'Artifact object expired under its retention policy',
    })
  })

  test('returns an authenticated same-origin download URL instead of an R2 signed URL', async () => {
    const { bucket, get } = bucketReturning(null)
    const response = await createArtifactStorageResponse({
      artifact,
      bucket,
      requestUrl: new URL(
        'https://app.example/api/artifacts/url?artifactId=artifact_123&expiresInSeconds=900',
      ),
    })

    expect(get).not.toHaveBeenCalled()
    expect(await response.json()).toEqual({
      ok: true,
      artifactId: artifact.id,
      workflowRunId: artifact.workflowRunId,
      url: '/api/artifacts/url?artifactId=artifact_123&download=1',
    })
  })

  test('never reflects the request origin or expiry into artifact URLs', async () => {
    const { bucket } = bucketReturning(null)
    const response = await createArtifactStorageResponse({
      artifact,
      bucket,
      requestUrl: new URL(
        'https://untrusted.example/api/artifacts/url?artifactId=artifact_123&workflowRunId=workflow_123&expiresInSeconds=900',
      ),
    })

    const payload = (await response.json()) as { readonly url: string }
    expect(payload.url).toBe(
      '/api/artifacts/url?artifactId=artifact_123&workflowRunId=workflow_123&download=1',
    )
    expect(payload.url).not.toContain('untrusted.example')
    expect(payload.url).not.toContain('expiresInSeconds')
  })

  test('rejects an R2 object that does not match durable evidence metadata', async () => {
    const object = objectWithBytes(new TextEncoder().encode('diff --git'))
    const { bucket } = bucketReturning({
      ...object,
      customMetadata: { sha256: 'sha256:mutated' },
    })
    const response = await createArtifactStorageResponse({
      artifact: { ...artifact, sizeBytes: object.size },
      bucket,
      requestUrl: new URL(
        'https://app.example/api/artifacts/url?artifactId=artifact_123&preview=1',
      ),
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      ok: false,
      code: 'artifact_identity_mismatch',
      error: 'Artifact object does not match its evidence metadata',
    })
  })

  test('rejects invalid UTF-8 without substituting replacement characters', async () => {
    const { bucket } = bucketReturning(
      objectWithBytes(new Uint8Array([0xc3, 0x28])),
    )
    const response = await createArtifactStorageResponse({
      artifact: { ...artifact, sizeBytes: 2 },
      bucket,
      requestUrl: new URL(
        'https://app.example/api/artifacts/url?artifactId=artifact_123&preview=1',
      ),
    })

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      ok: false,
      code: 'invalid_utf8',
      error: 'Artifact preview is not valid UTF-8 text',
    })
  })

  test('streams downloads as attachments to prevent same-origin content execution', async () => {
    const bytes = new TextEncoder().encode('diff --git')
    const { bucket } = bucketReturning(objectWithBytes(bytes))
    const response = await createArtifactStorageResponse({
      artifact: { ...artifact, sizeBytes: bytes.byteLength },
      bucket,
      requestUrl: new URL(
        'https://app.example/api/artifacts/url?artifactId=artifact_123&download=1',
      ),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="artifact-artifact_123"',
    )
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await response.text()).toBe('diff --git')
  })

  test('adds deterministic statistics to a complete textual diff preview', async () => {
    const body = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1 +1,2 @@
-old
+new
+another
`
    const object = objectWithBytes(new TextEncoder().encode(body))
    const response = await createArtifactStorageResponse({
      artifact: {
        ...artifact,
        contentType: 'text/x-diff',
        sizeBytes: object.size,
        sha256: artifact.sha256,
      },
      bucket: { get: async () => object },
      requestUrl: new URL(
        'https://patchplane.example/api/artifacts/url?artifactId=artifact_123&preview=1',
      ),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('x-patchplane-diff-stats')).toBe('parsed')
    expect(response.headers.get('x-patchplane-diff-files')).toBe('1')
    expect(response.headers.get('x-patchplane-diff-additions')).toBe('2')
    expect(response.headers.get('x-patchplane-diff-deletions')).toBe('1')
  })

  test('provides an explicit reason when statistics cannot be parsed', async () => {
    const body = `diff --git a/file.ts b/file.ts
GIT binary patch
literal 1
KcmZQzU|?Vb0RR91
`
    const object = objectWithBytes(new TextEncoder().encode(body))
    const response = await createArtifactStorageResponse({
      artifact: {
        ...artifact,
        contentType: 'text/x-diff',
        sizeBytes: object.size,
        sha256: artifact.sha256,
      },
      bucket: { get: async () => object },
      requestUrl: new URL(
        'https://patchplane.example/api/artifacts/url?artifactId=artifact_123&preview=1',
      ),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('x-patchplane-diff-stats')).toBe('unavailable')
    expect(response.headers.get('x-patchplane-diff-stats-reason')).toBe(
      'binary',
    )
  })
})
