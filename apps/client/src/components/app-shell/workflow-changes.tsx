import { useState } from 'react'
import { FileDiffIcon, GitCommitIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import type { WorkflowDetail } from './types'

export function WorkflowChanges({ detail }: { readonly detail: WorkflowDetail }) {
  const candidate = detail.candidatePatchSets.at(-1)
  const [diffPreview, setDiffPreview] = useState<string>()
  const [diffError, setDiffError] = useState<string>()
  const [loadingDiff, setLoadingDiff] = useState(false)
  const diff = candidate?.diffArtifactId === undefined
    ? undefined
    : detail.evidenceArtifacts.find((artifact) => artifact.id === candidate.diffArtifactId)

  if (candidate === undefined) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon"><FileDiffIcon /></EmptyMedia>
          <EmptyTitle>No candidate patch captured</EmptyTitle>
          <EmptyDescription>This workflow has not produced a reviewable change yet.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="ring-border">
        <CardHeader>
          <CardTitle as="h2" className="flex items-center gap-2"><FileDiffIcon />Change summary</CardTitle>
          <CardDescription>{candidate.summary ?? 'Candidate patch captured from the isolated sandbox.'}</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-3">
          <Metric label="Files" value={candidate.stats?.filesChanged ?? 'Unknown'} />
          <Metric label="Additions" value={candidate.stats === undefined ? 'Unknown' : `+${candidate.stats.additions}`} tone="success" />
          <Metric label="Deletions" value={candidate.stats === undefined ? 'Unknown' : `-${candidate.stats.deletions}`} tone="danger" />
        </CardContent>
      </Card>
      <Card className="ring-border">
        <CardHeader>
          <CardTitle as="h2" className="flex items-center gap-2"><GitCommitIcon />Candidate identity</CardTitle>
          <CardDescription>The exact patch projection evaluated by review and policy.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Identity label="Base" value={candidate.baseSha ?? candidate.baseRef ?? 'unknown'} />
          <Identity label="Head" value={candidate.headSha ?? candidate.headRef ?? 'sandbox worktree'} />
          <Identity label="Candidate" value={candidate.id} />
          <Identity label="Diff evidence" value={diff?.sha256 ?? 'not captured'} />
          {diff === undefined ? null : (
            <a className="text-sm font-medium underline underline-offset-4 sm:col-span-2" href={`?tab=evidence#artifact-${encodeURIComponent(diff.id)}`}>
              Inspect diff evidence
            </a>
          )}
        </CardContent>
      </Card>
      <Card className="ring-border lg:col-span-2">
        <CardHeader>
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
            <div><CardTitle as="h2">Unified diff</CardTitle><CardDescription>Exact changed lines from the candidate’s referenced evidence artifact.</CardDescription></div>
            {diff === undefined ? null : <Button size="sm" variant="outline" className="min-h-11 w-full sm:min-h-8 sm:w-auto" aria-busy={loadingDiff} disabled={loadingDiff} onClick={() => void loadDiffPreview(diff.id, setLoadingDiff, setDiffPreview, setDiffError)}>{loadingDiff ? 'Loading…' : diffPreview === undefined ? 'Load diff' : 'Reload'}</Button>}
          </div>
        </CardHeader>
        <CardContent>
          {diff === undefined ? <p className="m-0 text-sm text-muted-foreground">This candidate does not reference a diff artifact. Patch contents cannot be verified.</p> : diffError !== undefined ? <p role="alert" className="m-0 text-sm text-[var(--destructive-readable)]">{diffError}</p> : diffPreview === undefined ? <p className="m-0 text-sm text-muted-foreground">Load the durable diff to inspect changed files and lines without leaving the Patch Report.</p> : <ScrollArea className="h-[32rem] rounded-lg bg-[var(--surface-nested)]"><pre className="break-words p-3 font-mono text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">{diffPreview}</pre></ScrollArea>}
        </CardContent>
      </Card>
    </div>
  )
}

function artifactPreviewError(value: unknown) {
  if (typeof value !== 'object' || value === null) return undefined
  const error = Reflect.get(value, 'error')
  return typeof error === 'string' ? error : undefined
}

async function loadDiffPreview(
  artifactId: string,
  setLoading: (value: boolean) => void,
  setPreview: (value: string | undefined) => void,
  setError: (value: string | undefined) => void,
) {
  setLoading(true)
  setError(undefined)
  try {
    const response = await fetch(`/api/artifacts/url?artifactId=${encodeURIComponent(artifactId)}&preview=1`)
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => undefined)
      throw new Error(
        artifactPreviewError(payload) ?? `Diff preview failed (${response.status})`,
      )
    }
    setPreview(await response.text())
  } catch (cause) {
    setPreview(undefined)
    setError(cause instanceof Error ? cause.message : 'Diff could not be loaded')
  } finally {
    setLoading(false)
  }
}

function Metric({ label, value, tone }: { readonly label: string; readonly value: string | number; readonly tone?: 'success' | 'danger' }) {
  return (
    <div className="rounded-lg border border-border bg-[var(--surface-nested)] p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={tone === 'success' ? 'mt-1 text-lg font-semibold text-[var(--success-readable)]' : tone === 'danger' ? 'mt-1 text-lg font-semibold text-[var(--destructive-readable)]' : 'mt-1 text-lg font-semibold'}>{value}</div>
    </div>
  )
}

function Identity({ label, value }: { readonly label: string; readonly value: string }) {
  return <div className="min-w-0"><div className="text-xs text-muted-foreground">{label}</div><code className="mt-1 block break-all text-xs">{value}</code></div>
}
