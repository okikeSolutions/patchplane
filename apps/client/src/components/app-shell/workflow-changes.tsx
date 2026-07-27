import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeftIcon,
  CircleAlertIcon,
  FileDiffIcon,
  GitCommitIcon,
  Maximize2Icon,
} from 'lucide-react'
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
import { Separator } from '@/components/ui/separator'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import * as m from '@/paraglide/messages'
import { getAppLocale } from './app-language'
import { CandidateDiffRenderer } from './candidate-diff-renderer'
import type { CandidateDiffRendererFailure } from './candidate-diff-failure-boundary'
import type { WorkflowDetail } from './types'
import type { WorkflowDiffView } from './workflow-diff-navigation'
import {
  diffEvidenceProblem,
  type DiffEvidenceProblem,
  type DiffStatsResult,
  useCandidateDiffPreview,
} from './use-candidate-diff-preview'

export function WorkflowChanges({
  detail,
  expanded = false,
  selectedFileIndex,
  view = 'unified',
  onExpandedChange,
  onSelectedFileIndexChange,
  onViewChange,
}: {
  readonly detail: WorkflowDetail
  readonly expanded?: boolean
  readonly selectedFileIndex?: number | undefined
  readonly view?: WorkflowDiffView
  readonly onExpandedChange?: (expanded: boolean) => void
  readonly onSelectedFileIndexChange?: (index: number) => void
  readonly onViewChange?: (view: WorkflowDiffView) => void
}) {
  const expandButtonRef = useRef<HTMLButtonElement>(null)
  const backButtonRef = useRef<HTMLButtonElement>(null)
  const wasExpandedRef = useRef(expanded)
  const [rendererFailure, setRendererFailure] = useState<
    | {
        readonly identityKey: string
        readonly kind: CandidateDiffRendererFailure
      }
    | undefined
  >()
  useEffect(() => {
    if (expanded) backButtonRef.current?.focus()
    else if (wasExpandedRef.current) expandButtonRef.current?.focus()
    wasExpandedRef.current = expanded
  }, [expanded])
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
  const currentRendererProblem =
    rendererFailure !== undefined && rendererFailure.identityKey === identityKey
      ? diffEvidenceProblem(rendererFailure.kind)
      : undefined
  const diffProblem =
    coherenceProblem ?? storedDiffProblem ?? currentRendererProblem

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
    loadError: diffProblem !== undefined,
    persisted: candidate.stats !== undefined,
    calculated: currentCalculatedStats,
  })
  const currentPreviewProblem =
    diffPreview === undefined ? undefined : previewProblem(diffPreview.stats)
  const canExpandDiff =
    diff !== undefined &&
    identityKey !== undefined &&
    !loadingDiff &&
    currentPreviewProblem === undefined &&
    diffPreview !== undefined &&
    onExpandedChange !== undefined
  return (
    <div className="flex flex-col gap-6">
      {expanded ? null : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-6">
          <section
            aria-labelledby="candidate-change-summary"
            className="flex min-w-0 flex-col gap-4"
          >
            <div className="flex flex-col gap-1">
              <h2
                id="candidate-change-summary"
                className="flex items-center gap-2 text-base font-medium"
              >
                <FileDiffIcon />
                {m.app_changes_summary()}
              </h2>
              <p className="m-0 text-sm text-muted-foreground">
                {candidate.summary ?? m.app_changes_captured()}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-4">
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
            <p className="m-0 text-xs text-muted-foreground">
              {statisticsNote}
            </p>
          </section>
          <Separator className="lg:hidden" />
          <Separator orientation="vertical" className="hidden lg:block" />
          <section
            aria-labelledby="candidate-change-identity"
            className="flex min-w-0 flex-col gap-4"
          >
            <div className="flex flex-col gap-1">
              <h2
                id="candidate-change-identity"
                className="flex items-center gap-2 text-base font-medium"
              >
                <GitCommitIcon />
                {m.app_changes_identity()}
              </h2>
              <p className="m-0 text-sm text-muted-foreground">
                {m.app_changes_identity_detail()}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Identity
                label={m.app_changes_base()}
                value={
                  candidate.baseSha ??
                  candidate.baseRef ??
                  m.app_changes_unknown()
                }
              />
              <Identity
                label={m.app_changes_head()}
                value={
                  candidate.headSha ??
                  candidate.headRef ??
                  m.app_changes_worktree()
                }
              />
              <Identity
                label={m.app_changes_candidate()}
                value={candidate.id}
              />
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
            </div>
          </section>
        </div>
      )}
      <Card key="candidate-diff" className="ring-border">
        <CardHeader>
          {expanded ? (
            <Button
              ref={backButtonRef}
              type="button"
              variant="ghost"
              className="w-fit"
              onClick={() => onExpandedChange?.(false)}
            >
              <ArrowLeftIcon data-icon="inline-start" />
              {m.app_changes_back_report()}
            </Button>
          ) : null}
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
            <div>
              <CardTitle as="h2">{m.app_changes_unified_diff()}</CardTitle>
              <CardDescription>
                {m.app_changes_unified_detail()}
              </CardDescription>
            </div>
            {canExpandDiff && !expanded ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      ref={expandButtonRef}
                      type="button"
                      size="icon"
                      variant="outline"
                      aria-label={m.app_changes_expand()}
                      onClick={() => onExpandedChange(true)}
                    />
                  }
                >
                  <Maximize2Icon />
                </TooltipTrigger>
                <TooltipContent>{m.app_changes_expand()}</TooltipContent>
              </Tooltip>
            ) : null}
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
              loading={loadingDiff}
              onRetry={() => {
                if (currentRendererProblem !== undefined) {
                  window.location.reload()
                } else {
                  void reloadDiff()
                }
              }}
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
                <Alert aria-live="polite" variant="warning">
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
                expanded={expanded}
                projection={diffPreview.changedFiles}
                selectedFileIndex={selectedFileIndex}
                view={view}
                onFailure={(kind) => {
                  if (identityKey !== undefined) {
                    setRendererFailure({ identityKey, kind })
                  }
                }}
                onSelectedFileIndexChange={onSelectedFileIndexChange}
                onViewChange={onViewChange}
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
  loading = false,
  onRetry,
  problem,
}: {
  readonly artifactId?: string | undefined
  readonly candidateId: string
  readonly loading?: boolean | undefined
  readonly onRetry?: (() => void) | undefined
  readonly problem: DiffEvidenceProblem
}) {
  const copy = diffEvidenceProblemCopy(problem.kind)
  const warning =
    problem.retryable ||
    problem.kind === 'binary' ||
    problem.kind === 'oversized'
  return (
    <Alert role="alert" variant={warning ? 'warning' : 'destructive'}>
      <CircleAlertIcon />
      <AlertTitle>{copy.title}</AlertTitle>
      <AlertDescription className="grid gap-2">
        <p className="m-0">{copy.reason}</p>
        <p className="m-0">
          <strong>{m.app_changes_decision()}:</strong> {copy.consequence}
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
        {problem.recovery === 'retry' && onRetry !== undefined ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-1 w-fit"
            aria-busy={loading}
            disabled={loading}
            onClick={onRetry}
          >
            {m.app_changes_retry()}
          </Button>
        ) : problem.recovery === 'reload' ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-1 w-fit"
            onClick={() => window.location.reload()}
          >
            {m.app_changes_reload_session()}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}

function diffEvidenceProblemCopy(kind: DiffEvidenceProblem['kind']) {
  switch (kind) {
    case 'authentication':
      return {
        title: m.app_changes_problem_authentication_title(),
        reason: m.app_changes_problem_authentication_reason(),
        consequence: m.app_changes_problem_authentication_consequence(),
      }
    case 'authorization':
      return {
        title: m.app_changes_problem_authorization_title(),
        reason: m.app_changes_problem_authorization_reason(),
        consequence: m.app_changes_problem_authorization_consequence(),
      }
    case 'binary':
      return {
        title: m.app_changes_problem_binary_title(),
        reason: m.app_changes_problem_binary_reason(),
        consequence: m.app_changes_problem_binary_consequence(),
      }
    case 'empty':
      return {
        title: m.app_changes_problem_empty_title(),
        reason: m.app_changes_problem_empty_reason(),
        consequence: m.app_changes_problem_empty_consequence(),
      }
    case 'expired':
      return {
        title: m.app_changes_problem_expired_title(),
        reason: m.app_changes_problem_expired_reason(),
        consequence: m.app_changes_problem_expired_consequence(),
      }
    case 'integrity':
      return {
        title: m.app_changes_problem_integrity_title(),
        reason: m.app_changes_problem_integrity_reason(),
        consequence: m.app_changes_problem_integrity_consequence(),
      }
    case 'invalid-text':
      return {
        title: m.app_changes_problem_invalid_text_title(),
        reason: m.app_changes_problem_invalid_text_reason(),
        consequence: m.app_changes_problem_invalid_text_consequence(),
      }
    case 'malformed':
      return {
        title: m.app_changes_problem_malformed_title(),
        reason: m.app_changes_problem_malformed_reason(),
        consequence: m.app_changes_problem_malformed_consequence(),
      }
    case 'metadata-missing':
      return {
        title: m.app_changes_problem_metadata_missing_title(),
        reason: m.app_changes_problem_metadata_missing_reason(),
        consequence: m.app_changes_problem_metadata_missing_consequence(),
      }
    case 'missing':
      return {
        title: m.app_changes_problem_missing_title(),
        reason: m.app_changes_problem_missing_reason(),
        consequence: m.app_changes_problem_missing_consequence(),
      }
    case 'missing-reference':
      return {
        title: m.app_changes_problem_missing_reference_title(),
        reason: m.app_changes_problem_missing_reference_reason(),
        consequence: m.app_changes_problem_missing_reference_consequence(),
      }
    case 'oversized':
      return {
        title: m.app_changes_problem_oversized_title(),
        reason: m.app_changes_problem_oversized_reason(),
        consequence: m.app_changes_problem_oversized_consequence(),
      }
    case 'processor-unavailable':
      return {
        title: m.app_changes_problem_processor_unavailable_title(),
        reason: m.app_changes_problem_processor_unavailable_reason(),
        consequence: m.app_changes_problem_processor_unavailable_consequence(),
      }
    case 'projection-failed':
      return {
        title: m.app_changes_problem_projection_failed_title(),
        reason: m.app_changes_problem_projection_failed_reason(),
        consequence: m.app_changes_problem_projection_failed_consequence(),
      }
    case 'unavailable':
      return {
        title: m.app_changes_problem_unavailable_title(),
        reason: m.app_changes_problem_unavailable_reason(),
        consequence: m.app_changes_problem_unavailable_consequence(),
      }
  }
}

function formatBytes(value: number) {
  return `${value.toLocaleString(getAppLocale())} ${m.app_changes_bytes()}`
}

function candidateStatisticsNote(input: {
  readonly hasDiffArtifact: boolean
  readonly loading: boolean
  readonly loadError: boolean
  readonly persisted: boolean
  readonly calculated?: DiffStatsResult | undefined
}) {
  if (input.persisted) return m.app_changes_stats_captured()
  if (!input.hasDiffArtifact) {
    return m.app_changes_stats_unavailable()
  }
  if (input.loading) return m.app_changes_stats_calculating()
  if (input.loadError) {
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
    <div className="min-w-0">
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
