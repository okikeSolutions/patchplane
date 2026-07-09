import { api } from '@patchplane/backend/convex/_generated/api'
import type { Id } from '@patchplane/backend/convex/_generated/dataModel'
import { useQuery } from 'convex/react'
import { ArrowLeftIcon, BracesIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { WorkflowDetail } from './types'
import { sourceLabel } from './workflow-console-model'
import { WorkflowArtifactReferences } from './workflow-artifact-references'
import { WorkflowDetailOverview } from './workflow-detail-overview'
import { WorkflowLogViewer } from './workflow-log-viewer'
import { WorkflowReviewPanel } from './workflow-review-panel'
import { WorkflowRuntimeSessions } from './workflow-runtime-sessions'
import { WorkflowSandboxEvidence } from './workflow-sandbox-evidence'
import { WorkflowRunStatusBadge, WorkflowTrustStateBadge } from './workflow-status-badge'
import { WorkflowTimeline } from './workflow-timeline'
import { deriveWorkflowTrustState } from './workflow-trust-state'

export function WorkflowDetailPage({
  detailOverride,
  workflowRunId,
}: {
  readonly detailOverride?: WorkflowDetail
  readonly workflowRunId: Id<'workflowRuns'>
}) {
  const queriedDetail = useQuery(
    api.workflowStarts.getDetail,
    detailOverride === undefined ? { workflowRunId } : 'skip',
  ) as WorkflowDetail | undefined
  const detail = detailOverride ?? queriedDetail

  if (detail === undefined) {
    return <WorkflowDetailPageSkeleton />
  }

  const trustState = deriveWorkflowTrustState(detail)

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="border-b border-border/60 bg-background/95 px-4 py-4 lg:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <Button variant="ghost" size="sm" className="mb-2 px-0" onClick={() => history.back()}>
              <ArrowLeftIcon data-icon="inline-start" />
              Back to workflows
            </Button>
            <h1 className="line-clamp-2 text-xl font-semibold tracking-tight">
              Patch report: {detail.promptRequest.prompt}
            </h1>
            <p className="m-0 mt-2 truncate font-mono text-xs text-muted-foreground">
              {sourceLabel(detail)} · {detail.workflowRun.id}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <WorkflowRunStatusBadge status={detail.workflowRun.status} />
            <WorkflowTrustStateBadge state={trustState} />
            <Badge variant="secondary" className="bg-muted text-muted-foreground">
              {detail.runtimeEvents.length} runtime events
            </Badge>
            <Badge variant="secondary" className="bg-muted text-muted-foreground">
              {detail.sandboxExecutions.length} sandbox runs
            </Badge>
          </div>
        </div>
      </header>
      <main className="min-h-0 flex-1 p-4 lg:p-6">
        <Tabs defaultValue="overview" className="gap-4">
          <TabsList variant="line" className="flex-wrap justify-start">
            <TabsTrigger value="overview">Patch report</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="runtime">Agent activity</TabsTrigger>
            <TabsTrigger value="sandbox">Verification run</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
            <TabsTrigger value="artifacts">Evidence</TabsTrigger>
            <TabsTrigger value="review">Decision</TabsTrigger>
            <TabsTrigger value="raw">Raw</TabsTrigger>
          </TabsList>
          <TabsContent value="overview">
            <WorkflowDetailOverview detail={detail} />
          </TabsContent>
          <TabsContent value="timeline">
            <WorkflowTimeline detail={detail} />
          </TabsContent>
          <TabsContent value="runtime">
            <WorkflowRuntimeSessions sessions={detail.runtimeSessions} />
          </TabsContent>
          <TabsContent value="sandbox">
            <WorkflowSandboxEvidence executions={detail.sandboxExecutions} />
          </TabsContent>
          <TabsContent value="logs">
            <WorkflowLogViewer runtimeEvents={detail.runtimeEvents} sandboxExecutions={detail.sandboxExecutions} />
          </TabsContent>
          <TabsContent value="artifacts">
            <WorkflowArtifactReferences detail={detail} />
          </TabsContent>
          <TabsContent value="review">
            <WorkflowReviewPanel detail={detail} />
          </TabsContent>
          <TabsContent value="raw">
            <WorkflowRawEvidence detail={detail} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}

function WorkflowRawEvidence({ detail }: { readonly detail: WorkflowDetail }) {
  return (
    <Card className="ring-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BracesIcon />
          Raw report evidence
        </CardTitle>
        <CardDescription>
          Normalized Convex read-model payload used to assemble this patch report.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[32rem] rounded-lg bg-muted/30">
          <pre className="p-3 font-mono text-xs text-muted-foreground whitespace-pre-wrap">
            {JSON.stringify(detail, null, 2)}
          </pre>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

function WorkflowDetailPageSkeleton() {
  return (
    <div className="flex min-h-svh flex-col gap-4 p-6">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-10 w-3/4" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  )
}
