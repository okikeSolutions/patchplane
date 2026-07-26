export interface ArtifactStorageRecord {
  readonly id: string
  readonly workflowRunId: string
  readonly storageKey: string
  readonly contentType: string
  readonly sizeBytes: number
  readonly sha256: string
}

export interface ArtifactReadObject {
  readonly body: ReadableStream<Uint8Array>
  readonly size: number
  readonly customMetadata?: Readonly<Record<string, string>> | undefined
  readonly arrayBuffer: () => Promise<ArrayBuffer>
}

export interface ArtifactReadBucket {
  readonly get: (
    key: string,
    options?: { readonly range: { readonly offset: number; readonly length: number } },
  ) => Promise<ArtifactReadObject | null>
}

export const artifactPreviewLimitBytes = 200_000

function jsonResponse(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(body), { ...init, headers })
}

function artifactIdentityMatches(
  artifact: ArtifactStorageRecord,
  object: ArtifactReadObject,
) {
  return object.size === artifact.sizeBytes &&
    object.customMetadata?.sha256 === artifact.sha256
}

function identityMismatchResponse() {
  return jsonResponse(
    { ok: false, error: 'Artifact object does not match its evidence metadata' },
    { status: 409 },
  )
}

export async function createArtifactStorageResponse(input: {
  readonly artifact: ArtifactStorageRecord
  readonly bucket: ArtifactReadBucket
  readonly requestUrl: URL
}) {
  const { artifact, bucket, requestUrl } = input
  const preview = requestUrl.searchParams.get('preview') === '1'
  const download = requestUrl.searchParams.get('download') === '1'

  if (preview) {
    try {
      const object = await bucket.get(artifact.storageKey, {
        range: { offset: 0, length: artifactPreviewLimitBytes },
      })
      if (object === null) {
        return jsonResponse({ ok: false, error: 'Artifact object not found' }, { status: 404 })
      }
      if (!artifactIdentityMatches(artifact, object)) return identityMismatchResponse()
      const unboundedBytes = new Uint8Array(await object.arrayBuffer())
      const bytes = unboundedBytes.slice(0, artifactPreviewLimitBytes)
      if (bytes.includes(0)) {
        return jsonResponse({ ok: false, error: 'Binary artifacts cannot be previewed inline' }, { status: 415 })
      }
      const truncated = artifact.sizeBytes > artifactPreviewLimitBytes
      const body = new TextDecoder().decode(bytes)
      return new Response(
        truncated
          ? `${body}\n\n…preview truncated; open the full evidence artifact to inspect the remainder…`
          : body,
        {
          headers: {
            'cache-control': 'private, no-store',
            'content-type': 'text/plain; charset=utf-8',
            'x-content-type-options': 'nosniff',
            'x-patchplane-preview-truncated': String(truncated),
          },
        },
      )
    } catch {
      return jsonResponse({ ok: false, error: 'Artifact preview could not be read' }, { status: 502 })
    }
  }

  if (download) {
    try {
      const object = await bucket.get(artifact.storageKey)
      if (object === null) {
        return jsonResponse({ ok: false, error: 'Artifact object not found' }, { status: 404 })
      }
      if (!artifactIdentityMatches(artifact, object)) return identityMismatchResponse()
      return new Response(object.body, {
        headers: {
          'cache-control': 'private, no-store',
          'content-disposition': `attachment; filename="artifact-${artifact.id}"`,
          'content-length': String(object.size),
          'content-type': artifact.contentType,
          'x-content-type-options': 'nosniff',
        },
      })
    } catch {
      return jsonResponse({ ok: false, error: 'Artifact could not be read' }, { status: 502 })
    }
  }

  const downloadUrl = new URL(requestUrl)
  downloadUrl.searchParams.delete('expiresInSeconds')
  downloadUrl.searchParams.delete('preview')
  downloadUrl.searchParams.set('download', '1')
  return jsonResponse({
    ok: true,
    artifactId: artifact.id,
    workflowRunId: artifact.workflowRunId,
    url: `${downloadUrl.pathname}${downloadUrl.search}`,
  })
}
