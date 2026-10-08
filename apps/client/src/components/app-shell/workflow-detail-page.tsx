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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import * as m from '@/paraglide/messages'
import type { WorkflowDetail } from './types'
import { workflowDisplayTitle } from './workflow-console-model'
import { WorkflowDetailOverview } from './workflow-detail-overview'
import { LoadingWorkflowDetail } from './loading-workflow-detail'
import { WorkflowReviewPanel } from './workflow-review-panel'
import { WorkflowRerunPanel } from './workflow-rerun-panel'
import { WorkflowRuntimeSessions } from './workflow-runtime-sessions'
import { WorkflowTrustStateBadge } from './workflow-status-badge'
import { WorkflowTimeline } from './workflow-timeline'
import { deriveWorkflowTrustState } from './workflow-trust-state'
import type { WorkflowDiffNavigation } from './workflow-diff-navigation'
import { assessWorkflowReportCoherence } from './workflow-report-coherence'

import {
  WorkflowChangesSkeleton,
  WorkflowCoherenceAlert,
  WorkflowEvidenceWorkspace,
} from './workflow-detail-sections'
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
  diffNavigation,
  onRerunCreated,
  onOpenAttempt,
  onTabChange,
  onDiffNavigationChange,
}: {
  readonly detailOverride?: WorkflowDetail
  readonly workflowRunId: string
  readonly tab?: DetailTab
  readonly diffNavigation?: WorkflowDiffNavigation
  readonly onRerunCreated?: (workflowRunId: string) => void
  readonly onOpenAttempt?: (workflowRunId: string) => void
  readonly onTabChange?: (tab: DetailTab) => Promise<void> | void
  readonly onDiffNavigationChange?: (
    navigation: WorkflowDiffNavigation,
  ) => Promise<void> | void
}) {
  const queriedDetail = useQuery(
    api.workflowStarts.getDetail,
    detailOverride === undefined ? { workflowRunId } : 'skip',
  )
  const detail = detailOverride ?? queriedDetail
  const [internalTab, setInternalTab] = useState<DetailTab>(tab)
  const [internalDiffNavigation, setInternalDiffNavigation] =
    useState<WorkflowDiffNavigation>({
      expanded: false,
      selectedFileIndex: undefined,
      view: 'unified',
    })
  const activeDiffNavigation = diffNavigation ?? internalDiffNavigation
  const diffExpanded = activeDiffNavigation.expanded
  const activeTab = onTabChange === undefined ? internalTab : tab

  if (detail === undefined) return <LoadingWorkflowDetail tab={activeTab} />
  const trustState = deriveWorkflowTrustState(detail)
  const externalRef = detail.promptRequest.externalRef
  const title = workflowDisplayTitle(detail)
  const repository =
    externalRef?.repositoryFullName ?? detail.promptRequest.source
  const attemptNumber = detail.workflowRun.attemptNumber ?? 1
  const candidateStats = detail.candidatePatchSets.at(-1)?.stats
  const coherence = assessWorkflowReportCoherence(detail)

  function changeTab(value: string) {
    const next =
      detailTabs.find((detailTab) => detailTab === value) ?? 'summary'
    if (next !== 'changes') {
      setInternalDiffNavigation((current) => ({
        ...current,
        expanded: false,
      }))
    }
    setInternalTab(next)
    void onTabChange?.(next)
  }

  function changeDiffNavigation(next: Partial<WorkflowDiffNavigation>) {
    const navigation = { ...activeDiffNavigation, ...next }
    setInternalDiffNavigation(navigation)
    void onDiffNavigationChange?.(navigation)
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <header
        aria-labelledby="patch-report-title"
        hidden={diffExpanded}
        className={cn(
          'border-b border-border bg-background px-4 py-3 lg:px-6',
          diffExpanded && 'hidden',
        )}
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
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
        data-diff-expanded={diffExpanded || undefined}
        className={cn(
          'flex-1 px-4 pt-4 pb-10 lg:px-6 lg:pt-6 lg:pb-12',
          diffExpanded && 'min-h-0 p-3 lg:p-4',
        )}
      >
        {coherence.status === 'blocked' && !diffExpanded ? (
          <div className="mx-auto mb-4 w-full max-w-[100rem]">
            <WorkflowCoherenceAlert
              coherence={coherence}
              detail={detail}
              onOpenAttempt={onOpenAttempt}
            />
          </div>
        ) : null}
        <div
          className={cn(
            'mx-auto grid w-full max-w-[100rem] items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]',
            diffExpanded && 'max-w-none xl:grid-cols-1',
          )}
        >
          <div className="min-w-0">
            <Tabs value={activeTab} onValueChange={changeTab} className="gap-6">
              <TabsList
                variant="line"
                aria-label={m.app_detail_sections()}
                hidden={diffExpanded}
                className={cn(
                  'sticky top-0 z-20 h-auto w-full flex-wrap justify-start overflow-visible border-b border-border bg-background/95 py-1 backdrop-blur group-data-horizontal/tabs:h-auto supports-[backdrop-filter]:bg-background/80',
                  diffExpanded && 'hidden',
                )}
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
                    <WorkflowChanges
                      detail={detail}
                      expanded={diffExpanded}
                      selectedFileIndex={activeDiffNavigation.selectedFileIndex}
                      view={activeDiffNavigation.view}
                      onExpandedChange={(expanded) =>
                        changeDiffNavigation({ expanded })
                      }
                      onSelectedFileIndexChange={(selectedFileIndex) =>
                        changeDiffNavigation({ selectedFileIndex })
                      }
                      onViewChange={(view) => changeDiffNavigation({ view })}
                    />
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
            hidden={diffExpanded}
            className={cn(
              'self-start xl:sticky xl:top-4',
              diffExpanded && 'hidden',
            )}
          >
            <Card className="ring-border">
              <CardContent className="flex flex-col gap-4">
                <WorkflowReviewPanel coherence={coherence} detail={detail} />
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
