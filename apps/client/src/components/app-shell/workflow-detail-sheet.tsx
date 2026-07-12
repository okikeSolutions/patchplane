import { api } from '@patchplane/backend/convex/_generated/api'
import type { Id } from '@patchplane/backend/convex/_generated/dataModel'
import { useQuery } from 'convex/react'
import { AlertCircleIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { WorkflowDetail } from './types'
import { WorkflowArtifactReferences } from './workflow-artifact-references'
import { sourceLabel } from './workflow-console-model'
import { WorkflowDetailOverview } from './workflow-detail-overview'
import { WorkflowTimeline } from './workflow-timeline'
import { deriveWorkflowTrustState, workflowTrustStateLabel } from './workflow-trust-state'

export function WorkflowDetailSheet({
  detailOverride,
  workflowRunId,
}: {
  readonly detailOverride?: WorkflowDetail
  readonly workflowRunId: Id<'workflowRuns'>
}) {
  const queriedDetail = useQuery(
    api.workflowStarts.getDetail,
    detailOverride === undefined ? { workflowRunId } : 'skip',
  ) as
    | WorkflowDetail
    | undefined
  const detail = detailOverride ?? queriedDetail

  return (
    <SheetContent className="gap-0 border-border/60 sm:max-w-3xl" side="right">
      <SheetHeader className="border-b border-border/60">
        {detail === undefined ? (
          <>
            <SheetTitle>Loading workflow</SheetTitle>
            <SheetDescription>
              patchplane is reading workflow evidence from Convex.
            </SheetDescription>
          </>
        ) : (
          <>
            <SheetTitle className="line-clamp-2 pr-8">
              {detail.promptRequest.prompt}
            </SheetTitle>
            <SheetDescription className="truncate font-mono text-xs">
              {sourceLabel(detail)} · {workflowTrustStateLabel(deriveWorkflowTrustState(detail))} · {detail.workflowRun.id}
            </SheetDescription>
          </>
        )}
      </SheetHeader>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">
          {detail === undefined ? <WorkflowDetailSkeleton /> : <WorkflowDetailPreview detail={detail} />}
        </div>
      </ScrollArea>
    </SheetContent>
  )
}

function WorkflowDetailPreview({ detail }: { readonly detail: WorkflowDetail }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button
          size="sm"
          nativeButton={false}
          render={<a aria-label="Open full workflow" href={`/app/workflows/${detail.workflowRun.id}`} />}
        >
          Open full workflow
        </Button>
      </div>
      <Tabs defaultValue="overview" className="gap-4">
        <TabsList variant="line">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <WorkflowDetailOverview detail={detail} />
        </TabsContent>
        <TabsContent value="timeline">
          <WorkflowTimeline detail={detail} />
        </TabsContent>
        <TabsContent value="artifacts">
          <WorkflowArtifactReferences detail={detail} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function WorkflowDetailSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-40 w-full" />
      <Alert>
        <AlertCircleIcon />
        <AlertTitle>Loading workflow evidence</AlertTitle>
        <AlertDescription>
          patchplane is reading the workflow detail from Convex.
        </AlertDescription>
      </Alert>
    </div>
  )
}
