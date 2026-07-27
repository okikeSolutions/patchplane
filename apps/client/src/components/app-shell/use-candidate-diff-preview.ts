import { useQuery } from '@tanstack/react-query'
import { Option, Schema } from 'effect'
import {
  ProjectCandidateChangedFiles,
  type CandidateChangedFilesProjection,
} from '@patchplane/core/diff/project-candidate-changed-files'
import { EvidenceArtifactStorageRecord } from '@patchplane/domain/evidence-artifact'
import type { WorkflowDetail } from './types'

type CandidateStats = NonNullable<
  WorkflowDetail['candidatePatchSets'][number]['stats']
>

export type DiffStatsResult =
  | { readonly status: 'parsed'; readonly stats: CandidateStats }
  | {
      readonly status: 'unavailable'
      readonly reason:
        | 'binary'
        | 'empty'
        | 'malformed'
        | 'missing'
        | 'oversized'
        | 'truncated'
    }

export type DiffPreview = {
  readonly content: string
  readonly changedFiles: CandidateChangedFilesProjection
  readonly artifactSha256: string
  readonly artifactSizeBytes: number
  readonly returnedBytes: number
  readonly truncated: boolean
  readonly stats: DiffStatsResult
}

type LoadDiffPreviewResult =
  | { readonly status: 'loaded'; readonly preview: DiffPreview }
  | { readonly status: 'problem'; readonly problem: DiffEvidenceProblem }
  | { readonly status: 'aborted' }

export type DiffEvidenceProblemKind =
  | 'authentication'
  | 'authorization'
  | 'binary'
  | 'empty'
  | 'expired'
  | 'integrity'
  | 'invalid-text'
  | 'malformed'
  | 'metadata-missing'
  | 'missing'
  | 'missing-reference'
  | 'oversized'
  | 'processor-unavailable'
  | 'projection-failed'
  | 'unavailable'

export type DiffEvidenceProblem = {
  readonly kind: DiffEvidenceProblemKind
  readonly recovery: 'none' | 'reload' | 'retry'
  readonly retryable: boolean
}

type CandidateDiffArtifact = {
  readonly id: string
  readonly sha256: string
  readonly sizeBytes: number
}

const nonNegativeIntegerPattern = /^(0|[1-9]\d*)$/
const ArtifactPreviewProblemPayload = Schema.Struct({
  code: Schema.String,
})
const DiffPreviewMetadata = Schema.Struct({
  artifactSha256: EvidenceArtifactStorageRecord.fields.sha256,
  artifactSizeBytes: EvidenceArtifactStorageRecord.fields.sizeBytes,
  returnedBytes: EvidenceArtifactStorageRecord.fields.sizeBytes,
  truncated: Schema.Boolean,
})
const decodeArtifactPreviewProblem = Schema.decodeUnknownOption(
  ArtifactPreviewProblemPayload,
)
const decodeDiffPreviewMetadata =
  Schema.decodeUnknownOption(DiffPreviewMetadata)

const diffEvidenceProblems: Readonly<
  Record<DiffEvidenceProblemKind, DiffEvidenceProblem>
> = {
  authentication: {
    kind: 'authentication',
    recovery: 'reload',
    retryable: false,
  },
  authorization: {
    kind: 'authorization',
    recovery: 'none',
    retryable: false,
  },
  binary: {
    kind: 'binary',
    recovery: 'none',
    retryable: false,
  },
  empty: {
    kind: 'empty',
    recovery: 'none',
    retryable: false,
  },
  expired: {
    kind: 'expired',
    recovery: 'none',
    retryable: false,
  },
  integrity: {
    kind: 'integrity',
    recovery: 'none',
    retryable: false,
  },
  'invalid-text': {
    kind: 'invalid-text',
    recovery: 'none',
    retryable: false,
  },
  malformed: {
    kind: 'malformed',
    recovery: 'none',
    retryable: false,
  },
  'metadata-missing': {
    kind: 'metadata-missing',
    recovery: 'none',
    retryable: false,
  },
  missing: {
    kind: 'missing',
    recovery: 'none',
    retryable: false,
  },
  'missing-reference': {
    kind: 'missing-reference',
    recovery: 'none',
    retryable: false,
  },
  oversized: {
    kind: 'oversized',
    recovery: 'none',
    retryable: false,
  },
  'processor-unavailable': {
    kind: 'processor-unavailable',
    recovery: 'retry',
    retryable: true,
  },
  'projection-failed': {
    kind: 'projection-failed',
    recovery: 'none',
    retryable: false,
  },
  unavailable: {
    kind: 'unavailable',
    recovery: 'retry',
    retryable: true,
  },
}

export function useCandidateDiffPreview({
  artifact,
  candidateId,
  coherent,
  workflowRunId,
}: {
  readonly artifact?: CandidateDiffArtifact | undefined
  readonly candidateId?: string | undefined
  readonly coherent: boolean
  readonly workflowRunId: string
}) {
  const identityKey =
    artifact === undefined || candidateId === undefined
      ? undefined
      : JSON.stringify([
          workflowRunId,
          candidateId,
          artifact.id,
          artifact.sha256,
          artifact.sizeBytes,
        ])
  const query = useQuery({
    queryKey: ['candidate-diff-preview', identityKey],
    enabled: coherent && artifact !== undefined && candidateId !== undefined,
    queryFn: ({ signal }) => {
      if (artifact === undefined) {
        return Promise.resolve({
          status: 'problem',
          problem: diffEvidenceProblem('metadata-missing'),
        } satisfies LoadDiffPreviewResult)
      }
      return loadDiffPreview(artifact, workflowRunId, signal)
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 10 * 60 * 1_000,
    retry: false,
    refetchOnWindowFocus: false,
  })
  const result = query.data

  return {
    identityKey,
    preview: result?.status === 'loaded' ? result.preview : undefined,
    problem: result?.status === 'problem' ? result.problem : undefined,
    loading: query.isFetching,
    reload: query.refetch,
  } as const
}

export function diffEvidenceProblem(kind: DiffEvidenceProblemKind) {
  return diffEvidenceProblems[kind]
}

function artifactPreviewProblem(value: unknown, status: number) {
  const code = Option.getOrUndefined(decodeArtifactPreviewProblem(value))?.code
  if (code === 'authentication_required')
    return diffEvidenceProblem('authentication')
  if (code === 'artifact_authorization_required')
    return diffEvidenceProblem('authorization')
  if (code === 'artifact_expired') return diffEvidenceProblem('expired')
  if (code === 'binary_artifact') return diffEvidenceProblem('binary')
  if (code === 'invalid_utf8') return diffEvidenceProblem('invalid-text')
  if (code === 'artifact_identity_mismatch')
    return diffEvidenceProblem('integrity')
  if (
    code === 'artifact_metadata_not_found' ||
    code === 'artifact_object_not_found'
  )
    return diffEvidenceProblem('missing')
  if (
    code === 'artifact_metadata_unavailable' ||
    code === 'artifact_preview_read_failed' ||
    code === 'artifact_storage_unavailable'
  )
    return diffEvidenceProblem('unavailable')
  return status === 401
    ? diffEvidenceProblem('authentication')
    : status === 403
      ? diffEvidenceProblem('authorization')
      : status === 410
        ? diffEvidenceProblem('expired')
        : status === 404
          ? diffEvidenceProblem('missing')
          : diffEvidenceProblem('unavailable')
}

async function loadDiffPreview(
  artifact: CandidateDiffArtifact,
  workflowRunId: string,
  signal: AbortSignal,
): Promise<LoadDiffPreviewResult> {
  let response: Response
  try {
    const params = new URLSearchParams({
      artifactId: artifact.id,
      workflowRunId,
      preview: '1',
    })
    response = await fetch(`/api/artifacts/url?${params.toString()}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal,
    })
  } catch {
    return signal.aborted
      ? { status: 'aborted' }
      : {
          status: 'problem',
          problem: diffEvidenceProblem('unavailable'),
        }
  }

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => undefined)
    return {
      status: 'problem',
      problem: artifactPreviewProblem(payload, response.status),
    }
  }

  let content: string
  try {
    content = await response.text()
  } catch {
    return {
      status: 'problem',
      problem: diffEvidenceProblem('unavailable'),
    }
  }

  const metadata = decodeDiffPreviewHeaders(response)
  if (
    metadata === undefined ||
    metadata.artifactSha256 !== artifact.sha256 ||
    metadata.artifactSizeBytes !== artifact.sizeBytes
  ) {
    return {
      status: 'problem',
      problem: diffEvidenceProblem('integrity'),
    }
  }
  const stats = decodeDiffStatsHeaders(response) ?? {
    status: 'unavailable' as const,
    reason: 'missing' as const,
  }
  if (new TextEncoder().encode(content).byteLength !== metadata.returnedBytes) {
    return {
      status: 'problem',
      problem: diffEvidenceProblem('integrity'),
    }
  }

  let diffProjectionRuntime: typeof import('@/effect/diff-runtime').diffProjectionRuntime
  try {
    ;({ diffProjectionRuntime } = await import('@/effect/diff-runtime'))
  } catch {
    return {
      status: 'problem',
      problem: diffEvidenceProblem('processor-unavailable'),
    }
  }

  try {
    const changedFiles = await diffProjectionRuntime.runPromise(
      ProjectCandidateChangedFiles(content, {
        artifactTruncated: metadata.truncated,
      }),
    )
    return {
      status: 'loaded',
      preview: { changedFiles, content, stats, ...metadata },
    }
  } catch {
    return {
      status: 'problem',
      problem: diffEvidenceProblem('projection-failed'),
    }
  }
}

export function decodeDiffPreviewHeaders(
  response: Pick<Response, 'headers'>,
): Omit<DiffPreview, 'changedFiles' | 'content' | 'stats'> | undefined {
  const artifactSha256 = response.headers.get('x-patchplane-artifact-sha256')
  const artifactSize = response.headers.get('x-patchplane-artifact-size')
  const returnedSize = response.headers.get('x-patchplane-preview-bytes')
  const truncated = response.headers.get('x-patchplane-preview-truncated')
  if (
    artifactSha256 === null ||
    artifactSize === null ||
    returnedSize === null ||
    (truncated !== 'true' && truncated !== 'false') ||
    !nonNegativeIntegerPattern.test(artifactSize) ||
    !nonNegativeIntegerPattern.test(returnedSize)
  ) {
    return undefined
  }
  const artifactSizeBytes = Number(artifactSize)
  const returnedBytes = Number(returnedSize)
  if (
    !Number.isSafeInteger(artifactSizeBytes) ||
    !Number.isSafeInteger(returnedBytes) ||
    returnedBytes > artifactSizeBytes ||
    (truncated === 'true' && returnedBytes >= artifactSizeBytes) ||
    (truncated === 'false' && returnedBytes !== artifactSizeBytes)
  ) {
    return undefined
  }
  return Option.getOrUndefined(
    decodeDiffPreviewMetadata({
      artifactSha256,
      artifactSizeBytes,
      returnedBytes,
      truncated: truncated === 'true',
    }),
  )
}

export function decodeDiffStatsHeaders(
  response: Pick<Response, 'headers'>,
): DiffStatsResult | undefined {
  const status = response.headers.get('x-patchplane-diff-stats')
  if (status === 'unavailable') {
    const reason = response.headers.get('x-patchplane-diff-stats-reason')
    return reason === 'binary' ||
      reason === 'empty' ||
      reason === 'malformed' ||
      reason === 'oversized' ||
      reason === 'truncated'
      ? { status, reason }
      : undefined
  }
  if (status !== 'parsed') return undefined

  const values = [
    response.headers.get('x-patchplane-diff-files'),
    response.headers.get('x-patchplane-diff-additions'),
    response.headers.get('x-patchplane-diff-deletions'),
  ]
  if (
    !values.every(
      (value) =>
        value !== null &&
        nonNegativeIntegerPattern.test(value) &&
        Number.isSafeInteger(Number(value)),
    )
  ) {
    return undefined
  }
  const [filesChanged, additions, deletions] = values.map(Number)
  return filesChanged !== undefined &&
    additions !== undefined &&
    deletions !== undefined
    ? { status, stats: { filesChanged, additions, deletions } }
    : undefined
}
