import { lazy, Suspense, useState } from 'react'
import { api } from '@patchplane/backend/convex/_generated/api'
import { useQuery } from 'convex/react'
import { ExternalLinkIcon } from 'lucide-react'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import * as m from '@/paraglide/messages'
import type { WorkflowDetail } from './types'
import { workflowDisplayTitle } from './workflow-console-model'
import { WorkflowArtifactReferences } from './workflow-artifact-references'
import { WorkflowDetailOverview } from './workflow-detail-overview'
import {
  WorkflowEvidenceTable,
  type WorkflowEvidenceTableRow,
} from './workflow-evidence-table'
import { WorkflowLogViewer } from './workflow-log-viewer'
import { WorkflowReviewPanel } from './workflow-review-panel'
import { WorkflowRerunPanel } from './workflow-rerun-panel'
import { WorkflowRuntimeSessions } from './workflow-runtime-sessions'
import { WorkflowSandboxEvidence } from './workflow-sandbox-evidence'
import { WorkflowTrustStateBadge } from './workflow-status-badge'
import { WorkflowTimeline } from './workflow-timeline'
import { deriveWorkflowTrustState } from './workflow-trust-state'
import { localizeAppHref } from './app-language'

const WorkflowChanges = lazy(() =>
  import('./workflow-changes').then((module) => ({
    default: module.WorkflowChanges,
  })),
)

type DetailTab = 'summary' | 'changes' | 'evidence' | 'activity'
const detailTabs: ReadonlyArray<DetailTab> = [
  'summary',
  'changes',
  'evidence',
  'activity',
]

export function WorkflowDetailPage({
  detailOverride,
  workflowRunId,
  tab = 'summary',
  returnTo = '/app',
  onRerunCreated,
  onTabChange,
}: {
  readonly detailOverride?: WorkflowDetail
  readonly workflowRunId: string
  readonly tab?: DetailTab
  readonly returnTo?: string
  readonly onRerunCreated?: (workflowRunId: string) => void
  readonly onTabChange?: (tab: DetailTab) => Promise<void> | void
}) {
  const queriedDetail = useQuery(
    api.workflowStarts.getDetail,
    detailOverride === undefined ? { workflowRunId } : 'skip',
  ) as WorkflowDetail | undefined
  const detail = detailOverride ?? queriedDetail
  const [internalTab, setInternalTab] = useState<DetailTab>(tab)
  const activeTab = onTabChange === undefined ? internalTab : tab

  if (detail === undefined) return <WorkflowDetailPageSkeleton />
  const trustState = deriveWorkflowTrustState(detail)
  const externalRef = detail.promptRequest.externalRef
  const title = workflowDisplayTitle(detail)
  const repository =
    externalRef?.repositoryFullName ?? detail.promptRequest.source
  const attemptNumber = detail.workflowRun.attemptNumber ?? 1
  const candidateStats = detail.candidatePatchSets.at(-1)?.stats

  function changeTab(value: string) {
    const next = detailTabs.includes(value as DetailTab)
      ? (value as DetailTab)
      : 'summary'
    setInternalTab(next)
    void onTabChange?.(next)
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <header
        aria-labelledby="patch-report-title"
        className="border-b border-border bg-background px-4 py-3 lg:px-6"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <a
              className={buttonVariants({
                variant: 'ghost',
                size: 'sm',
                className: 'mb-1 min-h-11 px-2 md:min-h-8',
              })}
              href={localizeAppHref(returnTo)}
              aria-label={m.app_detail_back()}
            >
              {m.app_nav_workflows()}
            </a>
            <Breadcrumb aria-label={m.app_detail_context()} className="mb-1">
              <BreadcrumbList className="gap-1 text-xs">
                <BreadcrumbItem>{repository}</BreadcrumbItem>
                {externalRef?.pullRequestNumber === undefined ? null : (
                  <>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      PR #{externalRef.pullRequestNumber}
                    </BreadcrumbItem>
                  </>
                )}
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  {m.app_detail_attempt()} {attemptNumber}
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            <h1
              id="patch-report-title"
              tabIndex={-1}
              title={title}
              className="line-clamp-2 rounded-sm text-xl font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {title}
            </h1>
            <p className="m-0 mt-1 break-all font-mono text-xs text-muted-foreground">
              <span className="sr-only">{m.app_detail_run_id()} </span>
              {detail.workflowRun.id}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="sr-only">{m.app_detail_trust_status()} </span>
            <WorkflowTrustStateBadge state={trustState} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 md:min-h-8"
              aria-label={
                candidateStats === undefined
                  ? m.app_detail_view_changes()
                  : `${m.app_detail_view_changes()}: ${candidateStats.filesChanged} ${candidateStats.filesChanged === 1 ? m.app_detail_file() : m.app_detail_files()}, ${candidateStats.additions} ${m.app_detail_additions()}, ${candidateStats.deletions} ${m.app_detail_deletions()}`
              }
              onClick={() => changeTab('changes')}
            >
              {m.app_detail_changes()}
              {candidateStats === undefined ? null : (
                <span aria-hidden="true" className="text-muted-foreground">
                  {candidateStats.filesChanged}{' '}
                  {candidateStats.filesChanged === 1
                    ? m.app_detail_file()
                    : m.app_detail_files()}{' '}
                  · +{candidateStats.additions} · −{candidateStats.deletions}
                </span>
              )}
            </Button>
            {externalRef?.url === undefined ? null : (
              <a
                className={buttonVariants({
                  variant: 'outline',
                  size: 'sm',
                  className: 'min-h-11 md:min-h-8',
                })}
                href={externalRef.url}
                target="_blank"
                rel="noreferrer"
                aria-label={m.app_detail_open_github()}
              >
                GitHub
                <ExternalLinkIcon data-icon="inline-end" />
              </a>
            )}
          </div>
        </div>
      </header>
      <div
        data-slot="workflow-report-content"
        className="flex-1 px-4 pt-4 pb-10 lg:px-6 lg:pt-6 lg:pb-12"
      >
        <div className="mx-auto grid w-full max-w-[100rem] items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0">
            <Tabs value={activeTab} onValueChange={changeTab} className="gap-6">
              <TabsList
                variant="line"
                aria-label={m.app_detail_sections()}
                className="sticky top-0 z-20 h-auto w-full flex-wrap justify-start overflow-visible border-b border-border bg-background/95 py-1 backdrop-blur group-data-horizontal/tabs:h-auto supports-[backdrop-filter]:bg-background/80"
              >
                <TabsTrigger
                  value="summary"
                  className="min-h-10 flex-none px-3 sm:px-4"
                >
                  {m.app_detail_summary()}
                </TabsTrigger>
                <TabsTrigger
                  value="changes"
                  className="min-h-10 flex-none px-3 sm:px-4"
                >
                  {m.app_detail_changes()}
                </TabsTrigger>
                <TabsTrigger
                  value="evidence"
                  className="min-h-10 flex-none px-3 sm:px-4"
                >
                  {m.app_detail_evidence()}
                </TabsTrigger>
                <TabsTrigger
                  value="activity"
                  className="min-h-10 flex-none px-3 sm:px-4"
                >
                  {m.app_detail_activity()}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="summary">
                <WorkflowDetailOverview detail={detail} />
              </TabsContent>
              <TabsContent value="changes">
                {activeTab === 'changes' ? (
                  <Suspense fallback={<WorkflowChangesSkeleton />}>
                    <WorkflowChanges detail={detail} />
                  </Suspense>
                ) : null}
              </TabsContent>
              <TabsContent value="evidence">
                <WorkflowEvidenceWorkspace detail={detail} />
              </TabsContent>
              <TabsContent value="activity">
                <div className="flex flex-col gap-8">
                  <WorkflowTimeline detail={detail} />
                  <WorkflowRuntimeSessions sessions={detail.runtimeSessions} />
                </div>
              </TabsContent>
            </Tabs>
          </div>
          <aside
            data-slot="workflow-review-pane"
            className="self-start xl:sticky xl:top-4"
          >
            <Card className="ring-border">
              <CardContent className="flex flex-col gap-4">
                <WorkflowReviewPanel detail={detail} />
                <WorkflowRerunPanel
                  parentWorkflowRunId={detail.workflowRun.id}
                  onCreated={onRerunCreated}
                  unavailableReason={
                    detail.workflowRun.modelVersion !== 'v1'
                      ? m.app_detail_rerun_versioned_only()
                      : detail.workflowRun.status !== 'reviewed' &&
                          detail.workflowRun.status !== 'failed'
                        ? m.app_detail_rerun_wait()
                        : undefined
                  }
                />
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </div>
  )
}

function WorkflowEvidenceWorkspace({
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

function WorkflowDetailPageSkeleton() {
  return (
    <div className="flex min-h-full flex-1 flex-col gap-4 p-6">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-10 w-3/4" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  )
}

function WorkflowChangesSkeleton() {
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
