import { Effect } from 'effect'
import { ParseUnifiedDiffStats } from '@patchplane/core/diff/parse-unified-diff-stats'
import type { EvidenceArtifact } from '@patchplane/domain/evidence-artifact'
import { diffProjectionRuntime } from '@/effect/diff-runtime'

export type ArtifactStorageRecord = Pick<
  EvidenceArtifact,
  | 'contentType'
  | 'createdAt'
  | 'id'
  | 'retentionPolicy'
  | 'sha256'
  | 'sizeBytes'
  | 'storageKey'
  | 'workflowRunId'
>

export interface ArtifactReadObject {
  readonly body: ReadableStream<Uint8Array>
  readonly size: number
  readonly customMetadata?: Readonly<Record<string, string>> | undefined
  readonly arrayBuffer: () => Promise<ArrayBuffer>
}

export interface ArtifactReadBucket {
  readonly get: (
    key: string,
    options?: {
      readonly range: { readonly offset: number; readonly length: number }
    },
  ) => Promise<ArtifactReadObject | null>
}

export const artifactPreviewLimitBytes = 200_000
const dayMilliseconds = 24 * 60 * 60 * 1_000
const alphaRetentionPattern = /^alpha-(\d+)(?:d|-days)$/

function jsonResponse(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(body), { ...init, headers })
}

function artifactIdentityMatches(
  artifact: ArtifactStorageRecord,
  object: ArtifactReadObject,
) {
  return (
    object.size === artifact.sizeBytes &&
    object.customMetadata?.sha256 === artifact.sha256
  )
}

function identityMismatchResponse() {
  return jsonResponse(
    {
      ok: false,
      code: 'artifact_identity_mismatch',
      error: 'Artifact object does not match its evidence metadata',
    },
    { status: 409 },
  )
}

function artifactObjectMissingResponse(
  artifact: ArtifactStorageRecord,
  now: number,
) {
  const retentionMatch =
    artifact.retentionPolicy === undefined
      ? undefined
      : alphaRetentionPattern.exec(artifact.retentionPolicy)
  const retentionDays =
    retentionMatch === undefined || retentionMatch === null
      ? undefined
      : Number(retentionMatch[1])
  const expired =
    retentionDays !== undefined &&
    Number.isSafeInteger(retentionDays) &&
    retentionDays > 0 &&
    now >= artifact.createdAt + retentionDays * dayMilliseconds
  return jsonResponse(
    expired
      ? {
          ok: false,
          code: 'artifact_expired',
          error: 'Artifact object expired under its retention policy',
        }
      : {
          ok: false,
          code: 'artifact_object_not_found',
          error: 'Artifact object not found',
        },
    { status: expired ? 410 : 404 },
  )
}

export async function createArtifactStorageResponse(input: {
  readonly artifact: ArtifactStorageRecord
  readonly bucket: ArtifactReadBucket
  readonly now?: number | undefined
  readonly requestUrl: URL
}) {
  const { artifact, bucket, requestUrl } = input
  const now = input.now ?? Date.now()
  const preview = requestUrl.searchParams.get('preview') === '1'
  const download = requestUrl.searchParams.get('download') === '1'

  if (preview) {
    try {
      const object = await bucket.get(artifact.storageKey, {
        range: { offset: 0, length: artifactPreviewLimitBytes },
      })
      if (object === null) {
        return artifactObjectMissingResponse(artifact, now)
      }
      if (!artifactIdentityMatches(artifact, object))
        return identityMismatchResponse()
      const unboundedBytes = new Uint8Array(await object.arrayBuffer())
      const bytes = unboundedBytes.slice(0, artifactPreviewLimitBytes)
      if (bytes.includes(0)) {
        return jsonResponse(
          {
            ok: false,
            code: 'binary_artifact',
            error: 'Binary artifacts cannot be previewed inline',
          },
          { status: 415 },
        )
      }
      const truncated = artifact.sizeBytes > artifactPreviewLimitBytes
      let body: string
      try {
        body = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch {
        return jsonResponse(
          {
            ok: false,
            code: 'invalid_utf8',
            error: 'Artifact preview is not valid UTF-8 text',
          },
          { status: 422 },
        )
      }
      const headers = new Headers({
        'cache-control': 'private, no-store',
        'content-type': 'text/plain; charset=utf-8',
        'x-content-type-options': 'nosniff',
        'x-patchplane-artifact-sha256': artifact.sha256,
        'x-patchplane-artifact-size': String(artifact.sizeBytes),
        'x-patchplane-preview-bytes': String(bytes.byteLength),
        'x-patchplane-preview-truncated': String(truncated),
      })
      if (artifact.contentType === 'text/x-diff') {
        if (truncated) {
          headers.set('x-patchplane-diff-stats', 'unavailable')
          headers.set('x-patchplane-diff-stats-reason', 'truncated')
        } else {
          const result = await diffProjectionRuntime.runPromise(
            ParseUnifiedDiffStats(body).pipe(
              Effect.match({
                onFailure: ({ reason }) =>
                  ({ status: 'unavailable', reason }) as const,
                onSuccess: (stats) => ({ status: 'parsed', stats }) as const,
              }),
            ),
          )
          headers.set('x-patchplane-diff-stats', result.status)
          if (result.status === 'parsed') {
            headers.set(
              'x-patchplane-diff-files',
              String(result.stats.filesChanged),
            )
            headers.set(
              'x-patchplane-diff-additions',
              String(result.stats.additions),
            )
            headers.set(
              'x-patchplane-diff-deletions',
              String(result.stats.deletions),
            )
          } else {
            headers.set('x-patchplane-diff-stats-reason', result.reason)
          }
        }
      }
      return new Response(body, { headers })
    } catch {
      return jsonResponse(
        {
          ok: false,
          code: 'artifact_preview_read_failed',
          error: 'Artifact preview could not be read',
        },
        { status: 502 },
      )
    }
  }

  if (download) {
    try {
      const object = await bucket.get(artifact.storageKey)
      if (object === null) {
        return artifactObjectMissingResponse(artifact, now)
      }
      if (!artifactIdentityMatches(artifact, object))
        return identityMismatchResponse()
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
      return jsonResponse(
        {
          ok: false,
          code: 'artifact_read_failed',
          error: 'Artifact could not be read',
        },
        { status: 502 },
      )
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
