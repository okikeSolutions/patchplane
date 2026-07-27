import { CircleAlertIcon, FileDiffIcon, GitCommitIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import * as m from '@/paraglide/messages'
import { getAppLocale } from './app-language'
import { CandidateDiffRenderer } from './candidate-diff-renderer'
import type { WorkflowDetail } from './types'
import {
  diffEvidenceProblem,
  type DiffEvidenceProblem,
  type DiffStatsResult,
  useCandidateDiffPreview,
} from './use-candidate-diff-preview'

export function WorkflowChanges({
  detail,
}: {
  readonly detail: WorkflowDetail
}) {
  const candidate = detail.candidatePatchSets.at(-1)
  const referencedDiff =
    candidate?.diffArtifactId === undefined
      ? undefined
      : detail.evidenceArtifacts.find(
          (artifact) => artifact.id === candidate.diffArtifactId,
        )
  const candidateMatchesWorkflow =
    candidate === undefined || candidate.workflowRunId === detail.workflowRun.id
  const diffMatchesWorkflow =
    referencedDiff === undefined ||
    (referencedDiff.workflowRunId === detail.workflowRun.id &&
      referencedDiff.kind === 'diff')
  const coherentProjection = candidateMatchesWorkflow && diffMatchesWorkflow
  const diff = coherentProjection ? referencedDiff : undefined
  const {
    identityKey,
    loading: loadingDiff,
    preview: diffPreview,
    problem: storedDiffProblem,
    reload: reloadDiff,
  } = useCandidateDiffPreview({
    artifact: diff,
    candidateId: candidate?.id,
    coherent: coherentProjection,
    workflowRunId: detail.workflowRun.id,
  })
  const coherenceProblem = coherentProjection
    ? undefined
    : diffEvidenceProblem('integrity')
  const diffProblem = coherenceProblem ?? storedDiffProblem

  if (candidate === undefined) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileDiffIcon />
          </EmptyMedia>
          <EmptyTitle>{m.app_changes_empty()}</EmptyTitle>
          <EmptyDescription>{m.app_changes_empty_detail()}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const currentCalculatedStats =
    coherentProjection && diffPreview !== undefined
      ? diffPreview.stats
      : undefined
  const stats =
    (coherentProjection ? candidate.stats : undefined) ??
    (currentCalculatedStats?.status === 'parsed'
      ? currentCalculatedStats.stats
      : undefined)
  const statisticsNote = candidateStatisticsNote({
    hasDiffArtifact: diff !== undefined,
    loading: loadingDiff,
    loadError: diffProblem?.reason,
    persisted: candidate.stats !== undefined,
    calculated: currentCalculatedStats,
  })
  const currentPreviewProblem =
    diffPreview === undefined ? undefined : previewProblem(diffPreview.stats)
  const showDiffAction =
    diff !== undefined &&
    identityKey !== undefined &&
    !loadingDiff &&
    currentPreviewProblem === undefined &&
    (diffPreview !== undefined || diffProblem?.retryable === true)

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="ring-border">
        <CardHeader>
          <CardTitle as="h2" className="flex items-center gap-2">
            <FileDiffIcon />
            {m.app_changes_summary()}
          </CardTitle>
          <CardDescription>
            {candidate.summary ?? m.app_changes_captured()}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3">
            <Metric
              label={m.app_changes_files()}
              value={stats?.filesChanged ?? '—'}
            />
            <Metric
              label={m.app_changes_additions()}
              value={stats === undefined ? '—' : `+${stats.additions}`}
              tone="success"
            />
            <Metric
              label={m.app_changes_deletions()}
              value={stats === undefined ? '—' : `-${stats.deletions}`}
              tone="danger"
            />
          </div>
          <p className="m-0 mt-3 text-xs text-muted-foreground">
            {statisticsNote}
          </p>
        </CardContent>
      </Card>
      <Card className="ring-border">
        <CardHeader>
          <CardTitle as="h2" className="flex items-center gap-2">
            <GitCommitIcon />
            {m.app_changes_identity()}
          </CardTitle>
          <CardDescription>{m.app_changes_identity_detail()}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Identity
            label={m.app_changes_base()}
            value={
              candidate.baseSha ?? candidate.baseRef ?? m.app_changes_unknown()
            }
          />
          <Identity
            label={m.app_changes_head()}
            value={
              candidate.headSha ?? candidate.headRef ?? m.app_changes_worktree()
            }
          />
          <Identity label={m.app_changes_candidate()} value={candidate.id} />
          <Identity
            label={m.app_changes_diff_evidence()}
            value={diff?.sha256 ?? m.app_changes_not_captured()}
          />
          {diff === undefined ? null : (
            <a
              className="text-sm font-medium underline underline-offset-4 sm:col-span-2"
              href={`?tab=evidence#artifact-${encodeURIComponent(diff.id)}`}
            >
              {m.app_changes_inspect_evidence()}
            </a>
          )}
        </CardContent>
      </Card>
      <Card className="ring-border lg:col-span-2">
        <CardHeader>
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
            <div>
              <CardTitle as="h2">{m.app_changes_unified_diff()}</CardTitle>
              <CardDescription>
                {m.app_changes_unified_detail()}
              </CardDescription>
            </div>
            {!showDiffAction ? null : (
              <Button
                size="sm"
                variant="outline"
                className="min-h-11 w-full sm:min-h-8 sm:w-auto"
                aria-busy={loadingDiff}
                disabled={loadingDiff}
                onClick={() => void reloadDiff()}
              >
                {diffProblem !== undefined
                  ? m.app_changes_retry()
                  : m.app_changes_reload()}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {candidate.diffArtifactId === undefined ? (
            <DiffEvidenceProblemView
              candidateId={candidate.id}
              problem={diffEvidenceProblem('missing-reference')}
            />
          ) : coherenceProblem !== undefined ? (
            <DiffEvidenceProblemView
              artifactId={candidate.diffArtifactId}
              candidateId={candidate.id}
              problem={coherenceProblem}
            />
          ) : diff === undefined ? (
            <DiffEvidenceProblemView
              artifactId={candidate.diffArtifactId}
              candidateId={candidate.id}
              problem={diffEvidenceProblem('metadata-missing')}
            />
          ) : diffProblem !== undefined ? (
            <DiffEvidenceProblemView
              artifactId={diff.id}
              candidateId={candidate.id}
              problem={diffProblem}
            />
          ) : loadingDiff || diffPreview === undefined ? (
            <output
              aria-live="polite"
              className="block text-sm text-muted-foreground"
            >
              {m.app_changes_loading()}
            </output>
          ) : currentPreviewProblem !== undefined ? (
            <DiffEvidenceProblemView
              artifactId={diff.id}
              candidateId={candidate.id}
              problem={currentPreviewProblem}
            />
          ) : (
            <div className="grid gap-3">
              {diffPreview.truncated ? (
                <Alert aria-live="polite">
                  <CircleAlertIcon />
                  <AlertTitle>{m.app_changes_partial()}</AlertTitle>
                  <AlertDescription className="grid gap-2">
                    <p className="m-0">
                      {m.app_changes_showing()}{' '}
                      {formatBytes(diffPreview.returnedBytes)}{' '}
                      {m.app_changes_of()}{' '}
                      {formatBytes(diffPreview.artifactSizeBytes)}{' '}
                      {m.app_changes_from_artifact()}
                    </p>
                    <p className="m-0">
                      <strong>{m.app_changes_decision()}:</strong>{' '}
                      {m.app_changes_partial_warning()}
                    </p>
                  </AlertDescription>
                </Alert>
              ) : null}
              <CandidateDiffRenderer
                key={identityKey}
                content={diffPreview.content}
                projection={diffPreview.changedFiles}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function previewProblem(result: DiffStatsResult) {
  if (result.status === 'parsed') return undefined
  switch (result.reason) {
    case 'binary':
      return diffEvidenceProblem('binary')
    case 'empty':
      return diffEvidenceProblem('empty')
    case 'malformed':
      return diffEvidenceProblem('malformed')
    case 'oversized':
      return diffEvidenceProblem('oversized')
    case 'missing':
    case 'truncated':
      return undefined
  }
}

function DiffEvidenceProblemView({
  artifactId,
  candidateId,
  problem,
}: {
  readonly artifactId?: string | undefined
  readonly candidateId: string
  readonly problem: DiffEvidenceProblem
}) {
  const warning =
    problem.retryable ||
    problem.kind === 'binary' ||
    problem.kind === 'oversized'
  return (
    <Alert role="alert" variant={warning ? 'default' : 'destructive'}>
      <CircleAlertIcon />
      <AlertTitle>{problem.title}</AlertTitle>
      <AlertDescription className="grid gap-2">
        <p className="m-0">{problem.reason}</p>
        <p className="m-0">
          <strong>{problem.consequence.split(':')[0]}:</strong>
          {problem.consequence.slice(problem.consequence.indexOf(':') + 1)}
        </p>
        <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 font-mono text-xs">
          <span className="break-all">
            {m.app_changes_candidate()} {candidateId}
          </span>
          {artifactId === undefined ? null : (
            <span className="break-all">
              {m.app_changes_artifact()} {artifactId}
            </span>
          )}
        </div>
        {problem.retryable ? (
          <p className="m-0 text-xs">{m.app_changes_use_retry()}</p>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}

function formatBytes(value: number) {
  return `${value.toLocaleString(getAppLocale())} ${m.app_changes_bytes()}`
}

function candidateStatisticsNote(input: {
  readonly hasDiffArtifact: boolean
  readonly loading: boolean
  readonly loadError?: string | undefined
  readonly persisted: boolean
  readonly calculated?: DiffStatsResult | undefined
}) {
  if (input.persisted) return m.app_changes_stats_captured()
  if (!input.hasDiffArtifact) {
    return m.app_changes_stats_unavailable()
  }
  if (input.loading) return m.app_changes_stats_calculating()
  if (input.loadError !== undefined) {
    return m.app_changes_stats_retrieval_failed()
  }
  if (input.calculated?.status === 'parsed') {
    return m.app_changes_stats_calculated()
  }
  if (input.calculated?.status === 'unavailable') {
    switch (input.calculated.reason) {
      case 'binary':
        return m.app_changes_stats_binary()
      case 'empty':
        return m.app_changes_stats_empty()
      case 'malformed':
        return m.app_changes_stats_malformed()
      case 'missing':
        return m.app_changes_stats_missing()
      case 'oversized':
        return m.app_changes_stats_oversized()
      case 'truncated':
        return m.app_changes_stats_truncated()
    }
  }
  return m.app_changes_stats_load()
}

function Metric({
  label,
  value,
  tone,
}: {
  readonly label: string
  readonly value: string | number
  readonly tone?: 'success' | 'danger'
}) {
  return (
    <div className="rounded-lg border border-border bg-[var(--surface-nested)] p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={
          tone === 'success'
            ? 'mt-1 text-lg font-semibold text-[var(--success-readable)]'
            : tone === 'danger'
              ? 'mt-1 text-lg font-semibold text-[var(--destructive-readable)]'
              : 'mt-1 text-lg font-semibold'
        }
      >
        {value}
      </div>
    </div>
  )
}

function Identity({
  label,
  value,
}: {
  readonly label: string
  readonly value: string
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <code className="mt-1 block break-all text-xs">{value}</code>
    </div>
  )
}
