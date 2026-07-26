import { describe, expect, test, vi } from 'vitest'
import {
  artifactPreviewLimitBytes,
  createArtifactStorageResponse,
  type ArtifactReadBucket,
  type ArtifactReadObject,
} from './artifact-storage-response'

const artifact = {
  id: 'artifact_123',
  workflowRunId: 'workflow_123',
  storageKey: 'workflows/workflow_123/diff/artifact.patch',
  contentType: 'text/x-patch',
  sizeBytes: 12,
  sha256: 'sha256:test',
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
      requestUrl: new URL('https://app.example/api/artifacts/url?artifactId=artifact_123&preview=1'),
    })

    expect(get).toHaveBeenCalledWith(artifact.storageKey, {
      range: { offset: 0, length: artifactPreviewLimitBytes },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-patchplane-preview-truncated')).toBe('true')
    expect(await response.text()).toContain('preview truncated')
  })

  test('rejects binary inline previews', async () => {
    const { bucket } = bucketReturning(objectWithBytes(new Uint8Array([1, 0, 2])))
    const response = await createArtifactStorageResponse({
      artifact: { ...artifact, sizeBytes: 3 },
      bucket,
      requestUrl: new URL('https://app.example/api/artifacts/url?artifactId=artifact_123&preview=1'),
    })

    expect(response.status).toBe(415)
    expect(await response.json()).toEqual({
      ok: false,
      error: 'Binary artifacts cannot be previewed inline',
    })
  })

  test('returns an authenticated same-origin download URL instead of an R2 signed URL', async () => {
    const { bucket, get } = bucketReturning(null)
    const response = await createArtifactStorageResponse({
      artifact,
      bucket,
      requestUrl: new URL('https://app.example/api/artifacts/url?artifactId=artifact_123&expiresInSeconds=900'),
    })

    expect(get).not.toHaveBeenCalled()
    expect(await response.json()).toEqual({
      ok: true,
      artifactId: artifact.id,
      workflowRunId: artifact.workflowRunId,
      url: '/api/artifacts/url?artifactId=artifact_123&download=1',
    })
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
      requestUrl: new URL('https://app.example/api/artifacts/url?artifactId=artifact_123&preview=1'),
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      ok: false,
      error: 'Artifact object does not match its evidence metadata',
    })
  })

  test('streams downloads as attachments to prevent same-origin content execution', async () => {
    const bytes = new TextEncoder().encode('diff --git')
    const { bucket } = bucketReturning(objectWithBytes(bytes))
    const response = await createArtifactStorageResponse({
      artifact: { ...artifact, sizeBytes: bytes.byteLength },
      bucket,
      requestUrl: new URL('https://app.example/api/artifacts/url?artifactId=artifact_123&download=1'),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="artifact-artifact_123"')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await response.text()).toBe('diff --git')
  })
})
