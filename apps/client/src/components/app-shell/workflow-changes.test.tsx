// @vitest-environment jsdom

import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { diffProjectionRuntime } from '@/effect/diff-runtime'
import type { WorkflowDetail } from './types'
import { WorkflowChanges } from './workflow-changes'

vi.mock('./candidate-diff-renderer', () => ({
  CandidateDiffRenderer: ({ content }: { readonly content: string }) => (
    <>
      <nav aria-label="Changed files" />
      <pre data-testid="candidate-diff-content">{content}</pre>
    </>
  ),
}))

function detail(
  stats?: {
    readonly filesChanged: number
    readonly additions: number
    readonly deletions: number
  },
  artifactSizeBytes = 128,
): WorkflowDetail {
  return {
    promptRequest: {
      id: 'prompt-1',
      workspaceId: 'workos:org-1',
      actorId: 'github:octocat',
      traceId: 'trace-1',
      source: 'external',
      prompt: 'Update the implementation',
      status: 'created',
      createdAt: 1,
    },
    workflowRun: {
      id: 'run-1',
      promptRequestId: 'prompt-1',
      workspaceId: 'workos:org-1',
      traceId: 'trace-1',
      status: 'reviewed',
      createdAt: 1,
    },
    runtimeEvents: [],
    runtimeEventsTruncated: false,
    runtimeSessions: [],
    sandboxExecutions: [],
    evidenceArtifacts: [
      {
        id: 'artifact-1',
        workflowRunId: 'run-1',
        kind: 'diff',
        storageProvider: 'cloudflare-r2',
        storageKey: 'run-1/diff.patch',
        contentType: 'text/x-diff',
        sizeBytes: artifactSizeBytes,
        sha256: 'a'.repeat(64),
        createdAt: 1,
      },
    ],
    candidatePatchSets: [
      {
        id: 'candidate-1',
        workflowRunId: 'run-1',
        status: 'captured',
        diffArtifactId: 'artifact-1',
        ...(stats === undefined ? {} : { stats }),
        createdAt: 1,
      },
    ],
    verificationRequirements: [],
    verificationRequirementsTruncated: false,
    verificationResults: [],
    verificationResultsTruncated: false,
    reviewRuns: [],
    reviewFindings: [],
    policyDecisions: [],
    humanDecisions: [],
    publicationResults: [],
    provenanceEvents: [],
  }
}

function candidateDetail(input: {
  readonly artifactId: string
  readonly artifactSha256: string
  readonly artifactSizeBytes: number
  readonly candidateId: string
}): WorkflowDetail {
  const base = detail(undefined, input.artifactSizeBytes)
  return {
    ...base,
    evidenceArtifacts: base.evidenceArtifacts.map((artifact) => ({
      ...artifact,
      id: input.artifactId,
      sha256: input.artifactSha256,
    })),
    candidatePatchSets: base.candidatePatchSets.map((candidate) => ({
      ...candidate,
      id: input.candidateId,
      diffArtifactId: input.artifactId,
    })),
  }
}

function previewResponse(input: {
  readonly body: string
  readonly sha256: string
}) {
  const size = new TextEncoder().encode(input.body).byteLength
  return new Response(input.body, {
    status: 200,
    headers: {
      'x-patchplane-artifact-sha256': input.sha256,
      'x-patchplane-artifact-size': String(size),
      'x-patchplane-preview-bytes': String(size),
      'x-patchplane-preview-truncated': 'false',
      'x-patchplane-diff-stats': 'parsed',
      'x-patchplane-diff-files': '1',
      'x-patchplane-diff-additions': '1',
      'x-patchplane-diff-deletions': '1',
    },
  })
}

function renderChanges(workflowDetail: WorkflowDetail) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <WorkflowChanges detail={workflowDetail} />
    </QueryClientProvider>,
  )
  return {
    ...view,
    queryClient,
    rerenderDetail(nextDetail: WorkflowDetail) {
      view.rerender(
        <QueryClientProvider client={queryClient}>
          <WorkflowChanges detail={nextDetail} />
        </QueryClientProvider>,
      )
    },
  }
}

describe('WorkflowChanges candidate statistics', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  test('renders statistics persisted with the candidate', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    )
    renderChanges(detail({ filesChanged: 3, additions: 24, deletions: 7 }))

    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText('+24')).toBeTruthy()
    expect(screen.getByText('-7')).toBeTruthy()
    expect(screen.getByText('Captured with this candidate.')).toBeTruthy()
    expect(screen.queryByText('Unknown')).toBeNull()
  })

  test('calculates historical candidate statistics from the loaded diff', async () => {
    const body = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1 +1,2 @@
-old
+new
+another
`
    const fetchPreview = vi.fn(
      async () =>
        new Response(body, {
          status: 200,
          headers: {
            'x-patchplane-artifact-sha256': 'a'.repeat(64),
            'x-patchplane-artifact-size': String(
              new TextEncoder().encode(body).byteLength,
            ),
            'x-patchplane-preview-bytes': String(
              new TextEncoder().encode(body).byteLength,
            ),
            'x-patchplane-preview-truncated': 'false',
            'x-patchplane-diff-stats': 'parsed',
            'x-patchplane-diff-files': '1',
            'x-patchplane-diff-additions': '2',
            'x-patchplane-diff-deletions': '1',
          },
        }),
    )
    vi.stubGlobal('fetch', fetchPreview)
    renderChanges(detail(undefined, new TextEncoder().encode(body).byteLength))

    expect(screen.getByRole('status').textContent).toContain(
      'Loading the candidate-bound diff…',
    )

    await waitFor(() => {
      expect(
        within(screen.getByText('Files').parentElement!).getByText('1'),
      ).toBeTruthy()
      expect(screen.getByText('+2')).toBeTruthy()
      expect(screen.getByText('-1')).toBeTruthy()
    })
    expect(
      screen.getByText('Calculated from the loaded durable diff.'),
    ).toBeTruthy()
    expect(
      await screen.findByRole('navigation', { name: 'Changed files' }),
    ).toBeTruthy()
    expect(screen.queryByText('Unknown')).toBeNull()
    expect(fetchPreview).toHaveBeenCalledWith(
      '/api/artifacts/url?artifactId=artifact-1&workflowRunId=run-1&preview=1',
      expect.objectContaining({
        cache: 'no-store',
        credentials: 'same-origin',
        signal: expect.any(AbortSignal),
      }),
    )
  })

  test('reuses the identity-bound preview when returning to Changes', async () => {
    const body = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1 +1 @@
-old
+new
`
    const fetchPreview = vi.fn(async () =>
      previewResponse({ body, sha256: 'a'.repeat(64) }),
    )
    vi.stubGlobal('fetch', fetchPreview)
    const selectedDetail = detail(
      undefined,
      new TextEncoder().encode(body).byteLength,
    )
    const view = renderChanges(selectedDetail)

    expect(
      (await screen.findByTestId('candidate-diff-content')).textContent,
    ).toBe(body)
    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <div>Summary tab</div>
      </QueryClientProvider>,
    )
    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <WorkflowChanges detail={selectedDetail} />
      </QueryClientProvider>,
    )

    expect(
      (await screen.findByTestId('candidate-diff-content')).textContent,
    ).toBe(body)
    expect(fetchPreview).toHaveBeenCalledTimes(1)
  })

  test('explains why malformed diff statistics are unavailable', async () => {
    const body = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ malformed
`
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(body, {
            status: 200,
            headers: {
              'x-patchplane-artifact-sha256': 'a'.repeat(64),
              'x-patchplane-artifact-size': String(
                new TextEncoder().encode(body).byteLength,
              ),
              'x-patchplane-preview-bytes': String(
                new TextEncoder().encode(body).byteLength,
              ),
              'x-patchplane-preview-truncated': 'false',
              'x-patchplane-diff-stats': 'unavailable',
              'x-patchplane-diff-stats-reason': 'malformed',
            },
          }),
      ),
    )
    renderChanges(detail(undefined, new TextEncoder().encode(body).byteLength))

    expect(
      await screen.findByText(
        'Statistics unavailable because the diff is malformed or unsupported.',
      ),
    ).toBeTruthy()
    expect(
      screen.getByText('Diff format is malformed or unsupported'),
    ).toBeTruthy()
    expect(screen.queryByText('@@ malformed')).toBeNull()
    expect(screen.getAllByText('—')).toHaveLength(3)
  })

  test('renders binary evidence as an explicit non-renderable state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          {
            ok: false,
            code: 'binary_artifact',
            error: 'Binary artifacts cannot be previewed inline',
          },
          { status: 415 },
        ),
      ),
    )
    renderChanges(detail())

    expect(
      await screen.findByText('Binary diff cannot be rendered inline'),
    ).toBeTruthy()
    expect(screen.getByText('Candidate candidate-1')).toBeTruthy()
    expect(screen.getByText('Artifact artifact-1')).toBeTruthy()
    expect(screen.getByText(/explicit evidence-gap rationale/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry diff' })).toBeNull()
  })

  test('represents an artifact with no textual changes as a blocking state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('', {
            status: 200,
            headers: {
              'x-patchplane-artifact-sha256': 'a'.repeat(64),
              'x-patchplane-artifact-size': '0',
              'x-patchplane-preview-bytes': '0',
              'x-patchplane-preview-truncated': 'false',
              'x-patchplane-diff-stats': 'unavailable',
              'x-patchplane-diff-stats-reason': 'empty',
            },
          }),
      ),
    )
    renderChanges(detail(undefined, 0))

    expect(
      await screen.findByText('Diff contains no textual changes'),
    ).toBeTruthy()
    expect(
      screen.getByText(/blocked until the candidate is recaptured/),
    ).toBeTruthy()
    expect(screen.queryByTestId('candidate-diff-content')).toBeNull()
  })

  test('keeps truncated metadata outside the rendered diff content', async () => {
    const body = 'diff --git a/file.ts b/file.ts\n'
    const returnedBytes = new TextEncoder().encode(body).byteLength
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(body, {
            status: 200,
            headers: {
              'x-patchplane-artifact-sha256': 'a'.repeat(64),
              'x-patchplane-artifact-size': '300000',
              'x-patchplane-preview-bytes': String(returnedBytes),
              'x-patchplane-preview-truncated': 'true',
              'x-patchplane-diff-stats': 'unavailable',
              'x-patchplane-diff-stats-reason': 'truncated',
            },
          }),
      ),
    )
    renderChanges(detail(undefined, 300_000))

    expect(await screen.findByText('Partial diff preview')).toBeTruthy()
    expect(screen.getByText(/of 300,000 bytes/)).toBeTruthy()
    expect(screen.getByText(body.trim())).toBeTruthy()
    expect(screen.queryByText(/preview truncated; open/)).toBeNull()
  })

  test('fails closed when preview identity headers do not match the artifact', async () => {
    const body = 'diff --git a/file.ts b/file.ts\n'
    const size = new TextEncoder().encode(body).byteLength
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(body, {
            status: 200,
            headers: {
              'x-patchplane-artifact-sha256': 'b'.repeat(64),
              'x-patchplane-artifact-size': String(size),
              'x-patchplane-preview-bytes': String(size),
              'x-patchplane-preview-truncated': 'false',
              'x-patchplane-diff-stats': 'unavailable',
              'x-patchplane-diff-stats-reason': 'malformed',
            },
          }),
      ),
    )
    renderChanges(detail(undefined, size))

    expect(
      await screen.findByText('Diff evidence identity mismatch'),
    ).toBeTruthy()
    expect(screen.queryByText(body.trim())).toBeNull()
  })

  test('offers an exact-artifact retry for temporary storage failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          {
            ok: false,
            code: 'artifact_storage_unavailable',
            error: 'Artifact storage is unavailable',
          },
          { status: 503 },
        ),
      ),
    )
    renderChanges(detail())

    expect(await screen.findByText('Diff could not be retrieved')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry diff' })).toBeTruthy()
    expect(screen.getByText(/do not decide/)).toBeTruthy()
  })

  test('reports client projection failures separately from artifact retrieval', async () => {
    const body = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1 +1 @@
-old
+new
`
    vi.spyOn(diffProjectionRuntime, 'runPromise').mockRejectedValueOnce(
      new Error('projection failed'),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => previewResponse({ body, sha256: 'a'.repeat(64) })),
    )
    renderChanges(detail(undefined, new TextEncoder().encode(body).byteLength))

    expect(await screen.findByText('Diff could not be processed')).toBeTruthy()
    expect(
      screen.getByText(
        'The artifact was retrieved and identity-checked, but changed-file projection failed.',
      ),
    ).toBeTruthy()
    expect(
      screen.queryByText(/metadata, storage, or the bounded preview/),
    ).toBeNull()
  })

  test('discards an old preview when the selected candidate changes', async () => {
    const oldBody = `diff --git a/old.ts b/old.ts
--- a/old.ts
+++ b/old.ts
@@ -1 +1 @@
-old
+stale candidate content
`
    const newBody = `diff --git a/new.ts b/new.ts
--- a/new.ts
+++ b/new.ts
@@ -1 +1 @@
-old
+selected candidate content
`
    const oldSha = 'a'.repeat(64)
    const newSha = 'b'.repeat(64)
    let resolveOldPreview: ((response: Response) => void) | undefined
    const fetchPreview = vi.fn(
      (url: string | URL | Request): Promise<Response> => {
        if (String(url).includes('artifact-old')) {
          return new Promise((resolve) => {
            resolveOldPreview = resolve
          })
        }
        return Promise.resolve(
          previewResponse({ body: newBody, sha256: newSha }),
        )
      },
    )
    vi.stubGlobal('fetch', fetchPreview)
    const oldDetail = candidateDetail({
      artifactId: 'artifact-old',
      artifactSha256: oldSha,
      artifactSizeBytes: new TextEncoder().encode(oldBody).byteLength,
      candidateId: 'candidate-old',
    })
    const selectedDetail = candidateDetail({
      artifactId: 'artifact-selected',
      artifactSha256: newSha,
      artifactSizeBytes: new TextEncoder().encode(newBody).byteLength,
      candidateId: 'candidate-selected',
    })
    const view = renderChanges(oldDetail)

    view.rerenderDetail(selectedDetail)

    expect(await screen.findByText(/selected candidate content/)).toBeTruthy()
    await act(async () => {
      resolveOldPreview?.(previewResponse({ body: oldBody, sha256: oldSha }))
      await Promise.resolve()
    })

    expect(screen.getByText('candidate-selected')).toBeTruthy()
    expect(screen.getByText(/selected candidate content/)).toBeTruthy()
    expect(screen.queryByText(/stale candidate content/)).toBeNull()
  })

  test('fails closed when the referenced artifact belongs to another workflow', () => {
    const base = detail()
    const mismatched: WorkflowDetail = {
      ...base,
      evidenceArtifacts: base.evidenceArtifacts.map((artifact) => ({
        ...artifact,
        workflowRunId: 'run-other',
      })),
    }

    renderChanges(mismatched)

    expect(screen.getByText('Diff evidence identity mismatch')).toBeTruthy()
    expect(screen.getByText('Candidate candidate-1')).toBeTruthy()
    expect(screen.getByText('Artifact artifact-1')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()
  })
})
