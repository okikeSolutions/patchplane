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
  | 'binary'
  | 'empty'
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
  readonly title: string
  readonly reason: string
  readonly consequence: string
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
    title: 'Authentication required',
    reason:
      'The candidate-bound diff could not be authorized for this session.',
    consequence:
      'Decision: Treat review as blocked until authentication is restored and the same artifact loads.',
    retryable: false,
  },
  binary: {
    kind: 'binary',
    title: 'Binary diff cannot be rendered inline',
    reason:
      'The artifact is identity-checked evidence, but it has no trustworthy textual line view.',
    consequence:
      'Decision: Inspect the complete artifact and proceed only with an explicit evidence-gap rationale.',
    retryable: false,
  },
  empty: {
    kind: 'empty',
    title: 'Diff contains no textual changes',
    reason:
      'The candidate artifact does not contain a reviewable unified diff.',
    consequence:
      'Decision: Treat review as blocked until the candidate is recaptured or the empty change is explained.',
    retryable: false,
  },
  integrity: {
    kind: 'integrity',
    title: 'Diff evidence identity mismatch',
    reason:
      'The returned artifact metadata does not match the evidence record attached to this candidate.',
    consequence:
      'Decision: Approval is blocked. Do not use content from a mismatched artifact.',
    retryable: false,
  },
  'invalid-text': {
    kind: 'invalid-text',
    title: 'Diff is not valid UTF-8 text',
    reason:
      'The artifact cannot be decoded without changing its recorded bytes.',
    consequence:
      'Decision: Treat review as blocked until the artifact is recaptured in a supported format.',
    retryable: false,
  },
  malformed: {
    kind: 'malformed',
    title: 'Diff format is malformed or unsupported',
    reason:
      'PatchPlane cannot establish trustworthy file and hunk boundaries for this artifact.',
    consequence:
      'Decision: Treat review as blocked until the complete artifact is inspected or the diff is recaptured.',
    retryable: false,
  },
  'metadata-missing': {
    kind: 'metadata-missing',
    title: 'Diff evidence metadata is missing',
    reason:
      'The candidate references an artifact that is absent from this Patch Report projection.',
    consequence:
      'Decision: Approval is blocked until the candidate and evidence projection are coherent.',
    retryable: false,
  },
  missing: {
    kind: 'missing',
    title: 'Diff evidence is unavailable',
    reason:
      'The candidate-bound artifact or its stored object could not be found.',
    consequence:
      'Decision: Treat review as blocked until the exact evidence is restored or the candidate is recaptured.',
    retryable: false,
  },
  'missing-reference': {
    kind: 'missing-reference',
    title: 'Candidate has no diff evidence',
    reason: 'This candidate does not reference a durable diff artifact.',
    consequence:
      'Decision: Approval is blocked because the patch contents cannot be verified.',
    retryable: false,
  },
  oversized: {
    kind: 'oversized',
    title: 'Diff exceeds the supported inline limit',
    reason:
      'The complete artifact exists, but its structure cannot be safely represented in this viewer.',
    consequence:
      'Decision: Inspect the complete artifact and proceed only with an explicit evidence-gap rationale.',
    retryable: false,
  },
  'processor-unavailable': {
    kind: 'processor-unavailable',
    title: 'Diff processor could not be loaded',
    reason:
      'The artifact was retrieved and identity-checked, but its browser processing module is temporarily unavailable.',
    consequence:
      'Decision: Retry the same candidate-bound artifact and do not decide until its contents can be processed.',
    retryable: true,
  },
  'projection-failed': {
    kind: 'projection-failed',
    title: 'Diff could not be processed',
    reason:
      'The artifact was retrieved and identity-checked, but changed-file projection failed.',
    consequence:
      'Decision: Treat review as blocked until the processing failure is repaired or the complete artifact is inspected.',
    retryable: false,
  },
  unavailable: {
    kind: 'unavailable',
    title: 'Diff could not be retrieved',
    reason:
      'The authenticated artifact request or bounded preview is temporarily unavailable.',
    consequence:
      'Decision: Retry the same candidate-bound artifact and do not decide while its contents are unavailable.',
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
