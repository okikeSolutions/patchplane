import { Skeleton } from '@/components/ui/skeleton'
import * as m from '@/paraglide/messages'

export function LoadingWorkflowConsole() {
  return (
    <div
      className="flex min-h-[36rem] flex-none flex-col md:min-h-0 md:flex-1"
      aria-busy="true"
      aria-label={m.app_loading_workflows()}
    >
      <div className="flex min-h-16 items-center justify-between border-b border-border px-4 lg:px-6">
        <div className="space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3 w-52" />
        </div>
        <Skeleton className="h-9 w-72" />
      </div>
      <div className="min-h-0 flex-1 space-y-3 p-4 lg:p-6">
        {Array.from({ length: 7 }).map((_, index) => (
          <Skeleton key={index} className="h-14 w-full" />
        ))}
      </div>
      <output className="sr-only">{m.app_loading_workflows_detail()}</output>
    </div>
  )
}
