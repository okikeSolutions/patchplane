import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import * as m from '@/paraglide/messages'

type LoadingWorkflowDetailTab = 'summary' | 'changes' | 'evidence' | 'activity'

const tabWidths = ['w-20', 'w-20', 'w-20', 'w-20'] as const
const metricWidths = ['w-16', 'w-20', 'w-14', 'w-24', 'w-20'] as const
const rowWidths = ['w-4/5', 'w-3/5', 'w-3/4', 'w-1/2'] as const

export function LoadingWorkflowDetail({
  tab,
}: {
  readonly tab: LoadingWorkflowDetailTab
}) {
  return (
    <section
      aria-busy="true"
      aria-live="polite"
      aria-label={m.app_loading_patch_report()}
      data-loading-tab={tab}
      className="flex min-h-full flex-1 flex-col bg-background"
    >
      <div aria-hidden="true" className="flex min-h-full flex-1 flex-col">
        <div
          data-slot="workflow-report-loading-header"
          className="border-b border-border px-4 py-3 lg:px-6"
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 flex-col gap-2">
              <Skeleton className="h-3 w-52 max-w-full" />
              <Skeleton className="h-7 w-96 max-w-3/4" />
              <Skeleton className="h-3 w-44 max-w-full" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-8 w-28" />
              <Skeleton className="h-8 w-20" />
            </div>
          </div>
        </div>

        <div className="flex-1 px-4 pt-4 pb-10 lg:px-6 lg:pt-6 lg:pb-12">
          <div className="mx-auto grid w-full max-w-[100rem] items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="flex min-w-0 flex-col gap-6">
              <div
                data-slot="workflow-report-loading-tabs"
                className="flex h-11 items-center gap-6 px-3"
              >
                {tabWidths.map((width, index) => (
                  <Skeleton
                    key={index}
                    className={cn(
                      'h-4',
                      width,
                      index === tabIndex(tab) ? 'opacity-100' : 'opacity-60',
                    )}
                  />
                ))}
              </div>
              <Separator />
              <div data-slot="workflow-report-loading-panel">
                <LoadingTabPanel tab={tab} />
              </div>
            </div>

            <Card
              data-slot="workflow-report-loading-review"
              className="ring-border"
            >
              <CardHeader className="flex flex-col gap-2">
                <Skeleton className="h-6 w-36" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-48 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      <output className="sr-only">{m.app_loading_patch_report_detail()}</output>
    </section>
  )
}

function LoadingTabPanel({ tab }: { readonly tab: LoadingWorkflowDetailTab }) {
  switch (tab) {
    case 'changes':
      return <LoadingChangesPanel />
    case 'evidence':
      return <LoadingEvidencePanel />
    case 'activity':
      return <LoadingActivityPanel />
    case 'summary':
      return <LoadingSummaryPanel />
  }
}

function LoadingSummaryPanel() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-24 w-full" />
      <div className="flex flex-col gap-4">
        <Skeleton className="h-5 w-32" />
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-5">
          {metricWidths.map((width, index) => (
            <div key={index} className="flex flex-col gap-2">
              <Skeleton className={cn('h-3', width)} />
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      </div>
      <Separator />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="ring-border">
          <CardHeader className="flex flex-col gap-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-4/5" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-28" />
          </CardContent>
        </Card>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      </div>
      <Separator />
      <Skeleton className="h-28 w-full" />
    </div>
  )
}

function LoadingChangesPanel() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-6">
        <LoadingMetadataSection />
        <Separator className="lg:hidden" />
        <Separator orientation="vertical" className="hidden lg:block" />
        <LoadingMetadataSection />
      </div>
      <Card className="ring-border">
        <CardHeader className="flex flex-col gap-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-3/5" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-72 w-full" />
        </CardContent>
      </Card>
    </div>
  )
}

function LoadingMetadataSection() {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-4 w-full" />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  )
}

function LoadingEvidencePanel() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex h-12 items-center gap-5">
        {tabWidths.map((width, index) => (
          <Skeleton key={index} className={cn('h-4', width)} />
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-3/5" />
        {rowWidths.slice(0, 3).map((width, index) => (
          <Skeleton key={index} className={cn('h-20 max-w-full', width)} />
        ))}
      </div>
    </div>
  )
}

function LoadingActivityPanel() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-4 w-3/5" />
      <Card className="ring-border">
        <CardHeader>
          <div className="grid grid-cols-4 gap-4">
            {tabWidths.map((width, index) => (
              <Skeleton key={index} className={cn('h-4 max-w-full', width)} />
            ))}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {rowWidths.map((width, index) => (
            <div key={index} className="grid grid-cols-4 gap-4">
              <Skeleton className={cn('h-5 max-w-full', width)} />
              <Skeleton className="h-5 w-3/5" />
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-5 w-2/3" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

function tabIndex(tab: LoadingWorkflowDetailTab) {
  switch (tab) {
    case 'summary':
      return 0
    case 'changes':
      return 1
    case 'evidence':
      return 2
    case 'activity':
      return 3
  }
}
