import { Skeleton } from '@/components/ui/skeleton'

export function LoadingWorkflowConsole() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy="true" aria-label="Loading workflows">
      <div className="flex min-h-16 items-center justify-between border-b border-border px-4 lg:px-6">
        <div className="space-y-2"><Skeleton className="h-5 w-32" /><Skeleton className="h-3 w-52" /></div>
        <Skeleton className="h-9 w-72" />
      </div>
      <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-3 p-4 lg:p-6">{Array.from({ length: 7 }).map((_, index) => <Skeleton key={index} className="h-14 w-full" />)}</div>
        <div className="hidden border-l border-border p-5 xl:block"><Skeleton className="h-72 w-full" /></div>
      </div>
      <span className="sr-only">Loading workflow queue and report status.</span>
    </div>
  )
}
