import { useState } from 'react'
import { api } from '@patchplane/backend/convex/_generated/api'
import type { Id } from '@patchplane/backend/convex/_generated/dataModel'
import { useQuery } from 'convex/react'
import { ArrowLeftIcon, BracesIcon, ExternalLinkIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { WorkflowDetail } from './types'
import { WorkflowArtifactReferences } from './workflow-artifact-references'
import { WorkflowChanges } from './workflow-changes'
import { WorkflowDetailOverview } from './workflow-detail-overview'
import { WorkflowLogViewer } from './workflow-log-viewer'
import { WorkflowReviewPanel } from './workflow-review-panel'
import { WorkflowRuntimeSessions } from './workflow-runtime-sessions'
import { WorkflowSandboxEvidence } from './workflow-sandbox-evidence'
import { WorkflowRunStatusBadge, WorkflowTrustStateBadge } from './workflow-status-badge'
import { WorkflowTimeline } from './workflow-timeline'
import { deriveWorkflowTrustState } from './workflow-trust-state'

type DetailTab = 'summary' | 'changes' | 'evidence' | 'activity'
const detailTabs: ReadonlyArray<DetailTab> = ['summary', 'changes', 'evidence', 'activity']

export function WorkflowDetailPage({ detailOverride, workflowRunId, tab = 'summary', returnTo = '/app', onTabChange }: {
  readonly detailOverride?: WorkflowDetail
  readonly workflowRunId: Id<'workflowRuns'>
  readonly tab?: DetailTab
  readonly returnTo?: string
  readonly onTabChange?: (tab: DetailTab) => void
}) {
  const queriedDetail = useQuery(api.workflowStarts.getDetail, detailOverride === undefined ? { workflowRunId } : 'skip') as WorkflowDetail | undefined
  const detail = detailOverride ?? queriedDetail
  const [internalTab, setInternalTab] = useState<DetailTab>(tab)
  const activeTab = onTabChange === undefined ? internalTab : tab

  if (detail === undefined) return <WorkflowDetailPageSkeleton />
  const trustState = deriveWorkflowTrustState(detail)
  const externalRef = detail.promptRequest.externalRef

  function changeTab(value: string) {
    const next = detailTabs.includes(value as DetailTab) ? value as DetailTab : 'summary'
    setInternalTab(next)
    onTabChange?.(next)
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 px-4 py-3 backdrop-blur lg:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <Button variant="ghost" size="sm" className="mb-1 px-0" nativeButton={false} render={<a href={returnTo} aria-label="Back to workflows" />}>
              <ArrowLeftIcon data-icon="inline-start" />Workflows
            </Button>
            <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span>{detail.workflowRun.workspaceId.replace('workos:', '')}</span><span>/</span>
              <span>{externalRef?.repositoryFullName ?? detail.promptRequest.source}</span>
              {externalRef?.pullRequestNumber === undefined ? null : <><span>/</span><span>PR #{externalRef.pullRequestNumber}</span></>}
            </div>
            <h1 className="line-clamp-2 text-xl font-semibold tracking-tight">{detail.promptRequest.prompt}</h1>
            <p className="m-0 mt-1 truncate font-mono text-xs text-muted-foreground">{detail.workflowRun.id}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <WorkflowRunStatusBadge status={detail.workflowRun.status} />
            <WorkflowTrustStateBadge state={trustState} />
            {externalRef?.url === undefined ? null : (
              <Button variant="outline" size="sm" nativeButton={false} render={<a href={externalRef.url} target="_blank" rel="noreferrer" aria-label="Open source event on GitHub" />}>
                GitHub<ExternalLinkIcon data-icon="inline-end" />
              </Button>
            )}
          </div>
        </div>
      </header>
      <main className="min-h-0 flex-1 p-4 lg:p-6">
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <Tabs value={activeTab} onValueChange={changeTab} className="min-w-0 gap-4">
            <TabsList variant="line" className="w-full justify-start overflow-x-auto">
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="changes">Changes</TabsTrigger>
              <TabsTrigger value="evidence">Evidence</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>
            <TabsContent value="summary"><WorkflowDetailOverview detail={detail} /></TabsContent>
            <TabsContent value="changes"><WorkflowChanges detail={detail} /></TabsContent>
            <TabsContent value="evidence"><WorkflowEvidenceWorkspace detail={detail} /></TabsContent>
            <TabsContent value="activity">
              <div className="flex flex-col gap-8"><WorkflowTimeline detail={detail} /><WorkflowRuntimeSessions sessions={detail.runtimeSessions} /></div>
            </TabsContent>
          </Tabs>
          <aside className="xl:sticky xl:top-32">
            <Card className="ring-border"><CardContent><WorkflowReviewPanel detail={detail} /></CardContent></Card>
          </aside>
        </div>
      </main>
    </div>
  )
}

function WorkflowEvidenceWorkspace({ detail }: { readonly detail: WorkflowDetail }) {
  return (
    <Tabs defaultValue="artifacts" className="gap-4">
      <TabsList className="w-full justify-start overflow-x-auto">
        <TabsTrigger value="artifacts">Artifacts ({detail.evidenceArtifacts.length})</TabsTrigger>
        <TabsTrigger value="sandbox">Sandbox ({detail.sandboxExecutions.length})</TabsTrigger>
        <TabsTrigger value="logs">Logs</TabsTrigger>
        <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
      </TabsList>
      <TabsContent value="artifacts"><WorkflowArtifactReferences detail={detail} /></TabsContent>
      <TabsContent value="sandbox"><WorkflowSandboxEvidence executions={detail.sandboxExecutions} /></TabsContent>
      <TabsContent value="logs"><WorkflowLogViewer runtimeEvents={detail.runtimeEvents} runtimeEventsTruncated={detail.runtimeEventsTruncated} sandboxExecutions={detail.sandboxExecutions} /></TabsContent>
      <TabsContent value="diagnostics"><WorkflowRawEvidence detail={detail} /></TabsContent>
    </Tabs>
  )
}

function WorkflowRawEvidence({ detail }: { readonly detail: WorkflowDetail }) {
  return (
    <Card className="ring-border">
      <CardHeader><CardTitle className="flex items-center gap-2"><BracesIcon />Normalized diagnostics</CardTitle><CardDescription>PatchPlane-owned read-model data for debugging. Raw evidence remains in the linked artifacts.</CardDescription></CardHeader>
      <CardContent><ScrollArea className="h-80 rounded-lg bg-[var(--surface-nested)]"><pre className="p-3 font-mono text-xs text-muted-foreground whitespace-pre-wrap">{JSON.stringify(detail, null, 2)}</pre></ScrollArea></CardContent>
    </Card>
  )
}

function WorkflowDetailPageSkeleton() {
  return <div className="flex min-h-full flex-1 flex-col gap-4 p-6"><Skeleton className="h-8 w-40" /><Skeleton className="h-10 w-3/4" /><Skeleton className="h-12 w-full" /><Skeleton className="h-96 w-full" /></div>
}
