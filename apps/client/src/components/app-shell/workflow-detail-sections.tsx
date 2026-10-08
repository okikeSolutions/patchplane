import { Match } from 'effect'
import { CircleAlertIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import * as m from '@/paraglide/messages'
import type { WorkflowDetail } from './types'
import { WorkflowArtifactReferences } from './workflow-artifact-references'
import {
  WorkflowEvidenceTable,
  type WorkflowEvidenceTableRow,
} from './workflow-evidence-table'
import { WorkflowLogViewer } from './workflow-log-viewer'
import { WorkflowSandboxEvidence } from './workflow-sandbox-evidence'
import {
  type WorkflowReportCoherence,
  type WorkflowReportCoherenceIssue,
} from './workflow-report-coherence'

export function WorkflowCoherenceAlert({
  coherence,
  detail,
  onOpenAttempt,
}: {
  readonly coherence: Extract<WorkflowReportCoherence, { status: 'blocked' }>
  readonly detail: WorkflowDetail
  readonly onOpenAttempt?: ((workflowRunId: string) => void) | undefined
}) {
  const { newerAttempt } = detail

  return (
    <Alert role="alert" variant="destructive">
      <CircleAlertIcon />
      <AlertTitle>{m.app_coherence_blocked_title()}</AlertTitle>
      <AlertDescription className="grid gap-3">
        <ul className="m-0 flex list-disc flex-col gap-1 pl-4">
          {coherence.issues.map((issue) => (
            <li key={issue}>{coherenceIssueCopy(issue)}</li>
          ))}
        </ul>
        {newerAttempt === undefined ? null : (
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={() => onOpenAttempt?.(newerAttempt.workflowRunId)}
          >
            {m.app_coherence_open_attempt({
              attempt: newerAttempt.attemptNumber,
            })}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  )
}

function coherenceIssueCopy(issue: WorkflowReportCoherenceIssue) {
  return Match.value(issue).pipe(
    Match.when('candidate-stale', () => m.app_coherence_stale()),
    Match.when('candidate-mutated', () => m.app_coherence_mutated()),
    Match.when('candidate-mismatch', () => m.app_coherence_mismatched()),
    Match.when('superseded-attempt', () => m.app_coherence_superseded()),
    Match.exhaustive,
  )
}

export function WorkflowEvidenceWorkspace({
  detail,
}: {
  readonly detail: WorkflowDetail
}) {
  return (
    <Tabs defaultValue="artifacts" className="gap-5">
      <TabsList
        aria-label={m.app_detail_evidence_views()}
        className="h-auto max-w-full flex-wrap justify-start overflow-visible group-data-horizontal/tabs:h-auto"
      >
        <TabsTrigger
          value="artifacts"
          className="min-h-10 flex-none px-3 sm:px-4"
        >
          {m.app_detail_artifacts()} ({detail.evidenceArtifacts.length})
        </TabsTrigger>
        <TabsTrigger
          value="sandbox"
          className="min-h-10 flex-none px-3 sm:px-4"
        >
          {m.app_detail_sandbox()} ({detail.sandboxExecutions.length})
        </TabsTrigger>
        <TabsTrigger value="logs" className="min-h-10 flex-none px-3 sm:px-4">
          {m.app_detail_logs()}
        </TabsTrigger>
        <TabsTrigger
          value="diagnostics"
          className="min-h-10 flex-none px-3 sm:px-4"
        >
          {m.app_detail_diagnostics()}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="artifacts">
        <WorkflowArtifactReferences detail={detail} />
      </TabsContent>
      <TabsContent value="sandbox">
        <WorkflowSandboxEvidence executions={detail.sandboxExecutions} />
      </TabsContent>
      <TabsContent value="logs">
        <WorkflowLogViewer
          runtimeEvents={detail.runtimeEvents}
          runtimeEventsTruncated={detail.runtimeEventsTruncated}
          sandboxExecutions={detail.sandboxExecutions}
        />
      </TabsContent>
      <TabsContent value="diagnostics">
        <WorkflowRawEvidence detail={detail} />
      </TabsContent>
    </Tabs>
  )
}

function diagnosticCollection(
  key: string,
  title: string,
  source: string,
  records: ReadonlyArray<unknown>,
  truncated = false,
): WorkflowEvidenceTableRow {
  return {
    key,
    title,
    source,
    label: `${String(records.length)} ${records.length === 1 ? m.app_table_record() : m.app_table_records()}${truncated ? ` · ${m.app_table_partial()}` : ''}`,
    detail: JSON.stringify({ records, truncated }, null, 2),
  }
}

function WorkflowRawEvidence({ detail }: { readonly detail: WorkflowDetail }) {
  const rows: ReadonlyArray<WorkflowEvidenceTableRow> = [
    {
      key: 'prompt-request',
      title: m.app_diagnostics_prompt(),
      source: detail.promptRequest.source,
      label: detail.promptRequest.status,
      occurredAt: detail.promptRequest.createdAt,
      detail: JSON.stringify(detail.promptRequest, null, 2),
    },
    {
      key: 'workflow-run',
      title: m.app_diagnostics_workflow(),
      source: 'control-plane',
      label: detail.workflowRun.status,
      occurredAt: detail.workflowRun.createdAt,
      detail: JSON.stringify(detail.workflowRun, null, 2),
    },
    diagnosticCollection(
      'runtime-events',
      m.app_diagnostics_runtime_events(),
      'runtime',
      detail.runtimeEvents,
      detail.runtimeEventsTruncated,
    ),
    diagnosticCollection(
      'runtime-sessions',
      m.app_diagnostics_runtime_sessions(),
      'runtime',
      detail.runtimeSessions,
      detail.runtimeSessionsTruncated,
    ),
    diagnosticCollection(
      'sandbox-executions',
      m.app_diagnostics_sandbox_executions(),
      'sandbox',
      detail.sandboxExecutions,
      detail.sandboxExecutionsTruncated,
    ),
    diagnosticCollection(
      'evidence-artifacts',
      m.app_diagnostics_evidence_artifacts(),
      'evidence',
      detail.evidenceArtifacts,
      detail.evidenceArtifactsTruncated,
    ),
    diagnosticCollection(
      'candidate-patch-sets',
      m.app_diagnostics_candidate_sets(),
      'candidate',
      detail.candidatePatchSets,
      detail.candidatePatchSetsTruncated,
    ),
    diagnosticCollection(
      'verification-requirements',
      m.app_diagnostics_verification_requirements(),
      'verification',
      detail.verificationRequirements,
      detail.verificationRequirementsTruncated,
    ),
    diagnosticCollection(
      'verification-results',
      m.app_diagnostics_verification_results(),
      'verification',
      detail.verificationResults,
      detail.verificationResultsTruncated,
    ),
    diagnosticCollection(
      'review-runs',
      m.app_diagnostics_review_runs(),
      'review',
      detail.reviewRuns,
      detail.reviewRunsTruncated,
    ),
    diagnosticCollection(
      'review-findings',
      m.app_diagnostics_review_findings(),
      'review',
      detail.reviewFindings,
      detail.reviewFindingsTruncated,
    ),
    diagnosticCollection(
      'policy-decisions',
      m.app_diagnostics_policy_decisions(),
      'policy',
      detail.policyDecisions,
      detail.policyDecisionsTruncated,
    ),
    diagnosticCollection(
      'human-decisions',
      m.app_diagnostics_human_decisions(),
      'decision',
      detail.humanDecisions,
      detail.humanDecisionsTruncated,
    ),
    diagnosticCollection(
      'publication-results',
      m.app_diagnostics_publication_results(),
      'publication',
      detail.publicationResults,
      detail.publicationResultsTruncated,
    ),
    diagnosticCollection(
      'provenance-events',
      m.app_diagnostics_provenance_events(),
      'provenance',
      detail.provenanceEvents,
      detail.provenanceEventsTruncated,
    ),
  ]

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-medium">{m.app_diagnostics_title()}</h2>
        <p className="m-0 mt-1 text-sm text-muted-foreground">
          {m.app_diagnostics_detail()}
        </p>
      </div>
      <WorkflowEvidenceTable
        caption={m.app_diagnostics_caption()}
        emptyTitle={m.app_diagnostics_empty()}
        rows={rows}
      />
    </section>
  )
}

export function WorkflowChangesSkeleton() {
  return (
    <div
      aria-label={m.app_changes_loading()}
      aria-live="polite"
      className="flex flex-col gap-6 py-2"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}
