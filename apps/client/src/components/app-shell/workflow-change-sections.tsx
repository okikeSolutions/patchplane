import { Match } from 'effect'
import { CircleAlertIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import * as m from '@/paraglide/messages'
import { getAppLocale } from './app-language'
import {
  diffEvidenceProblem,
  type DiffEvidenceProblem,
  type DiffStatsResult,
} from './use-candidate-diff-preview'

export function previewProblem(result: DiffStatsResult) {
  if (result.status === 'parsed') return undefined
  return Match.value(result.reason).pipe(
    Match.when('binary', () => diffEvidenceProblem('binary')),
    Match.when('empty', () => diffEvidenceProblem('empty')),
    Match.when('malformed', () => diffEvidenceProblem('malformed')),
    Match.when('oversized', () => diffEvidenceProblem('oversized')),
    Match.when('missing', () => undefined),
    Match.when('truncated', () => undefined),
    Match.exhaustive,
  )
}

export function DiffEvidenceProblemView({
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
  return Match.value(kind).pipe(
    Match.when('authentication', () => ({
      title: m.app_changes_problem_authentication_title(),
      reason: m.app_changes_problem_authentication_reason(),
      consequence: m.app_changes_problem_authentication_consequence(),
    })),
    Match.when('authorization', () => ({
      title: m.app_changes_problem_authorization_title(),
      reason: m.app_changes_problem_authorization_reason(),
      consequence: m.app_changes_problem_authorization_consequence(),
    })),
    Match.when('binary', () => ({
      title: m.app_changes_problem_binary_title(),
      reason: m.app_changes_problem_binary_reason(),
      consequence: m.app_changes_problem_binary_consequence(),
    })),
    Match.when('empty', () => ({
      title: m.app_changes_problem_empty_title(),
      reason: m.app_changes_problem_empty_reason(),
      consequence: m.app_changes_problem_empty_consequence(),
    })),
    Match.when('expired', () => ({
      title: m.app_changes_problem_expired_title(),
      reason: m.app_changes_problem_expired_reason(),
      consequence: m.app_changes_problem_expired_consequence(),
    })),
    Match.when('integrity', () => ({
      title: m.app_changes_problem_integrity_title(),
      reason: m.app_changes_problem_integrity_reason(),
      consequence: m.app_changes_problem_integrity_consequence(),
    })),
    Match.when('invalid-text', () => ({
      title: m.app_changes_problem_invalid_text_title(),
      reason: m.app_changes_problem_invalid_text_reason(),
      consequence: m.app_changes_problem_invalid_text_consequence(),
    })),
    Match.when('malformed', () => ({
      title: m.app_changes_problem_malformed_title(),
      reason: m.app_changes_problem_malformed_reason(),
      consequence: m.app_changes_problem_malformed_consequence(),
    })),
    Match.when('metadata-missing', () => ({
      title: m.app_changes_problem_metadata_missing_title(),
      reason: m.app_changes_problem_metadata_missing_reason(),
      consequence: m.app_changes_problem_metadata_missing_consequence(),
    })),
    Match.when('missing', () => ({
      title: m.app_changes_problem_missing_title(),
      reason: m.app_changes_problem_missing_reason(),
      consequence: m.app_changes_problem_missing_consequence(),
    })),
    Match.when('missing-reference', () => ({
      title: m.app_changes_problem_missing_reference_title(),
      reason: m.app_changes_problem_missing_reference_reason(),
      consequence: m.app_changes_problem_missing_reference_consequence(),
    })),
    Match.when('oversized', () => ({
      title: m.app_changes_problem_oversized_title(),
      reason: m.app_changes_problem_oversized_reason(),
      consequence: m.app_changes_problem_oversized_consequence(),
    })),
    Match.when('processor-unavailable', () => ({
      title: m.app_changes_problem_processor_unavailable_title(),
      reason: m.app_changes_problem_processor_unavailable_reason(),
      consequence: m.app_changes_problem_processor_unavailable_consequence(),
    })),
    Match.when('projection-failed', () => ({
      title: m.app_changes_problem_projection_failed_title(),
      reason: m.app_changes_problem_projection_failed_reason(),
      consequence: m.app_changes_problem_projection_failed_consequence(),
    })),
    Match.when('unavailable', () => ({
      title: m.app_changes_problem_unavailable_title(),
      reason: m.app_changes_problem_unavailable_reason(),
      consequence: m.app_changes_problem_unavailable_consequence(),
    })),
    Match.exhaustive,
  )
}

export function formatBytes(value: number) {
  return `${value.toLocaleString(getAppLocale())} ${m.app_changes_bytes()}`
}

export function candidateStatisticsNote(input: {
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
    return Match.value(input.calculated.reason).pipe(
      Match.when('binary', () => m.app_changes_stats_binary()),
      Match.when('empty', () => m.app_changes_stats_empty()),
      Match.when('malformed', () => m.app_changes_stats_malformed()),
      Match.when('missing', () => m.app_changes_stats_missing()),
      Match.when('oversized', () => m.app_changes_stats_oversized()),
      Match.when('truncated', () => m.app_changes_stats_truncated()),
      Match.exhaustive,
    )
  }
  return m.app_changes_stats_load()
}

export function Metric({
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

export function Identity({
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
