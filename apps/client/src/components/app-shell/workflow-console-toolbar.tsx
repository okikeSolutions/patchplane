import type { ReactNode } from 'react'
import { PlusIcon, SearchIcon, WorkflowIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { StartWorkflowPanel } from './start-workflow-panel'
import type { ViewerIdentity } from './types'
import type { WorkflowFilter } from './workflow-console-model'

export function WorkflowConsoleToolbar({
  filter,
  metrics,
  query,
  viewer,
  onFilterChange,
  onQueryChange,
}: {
  readonly filter: WorkflowFilter
  readonly metrics: {
    readonly visibleRequests: number
    readonly appRequests: number
    readonly externalRequests: number
  }
  readonly query: string
  readonly viewer: ViewerIdentity | undefined
  readonly onFilterChange: (filter: WorkflowFilter) => void
  readonly onQueryChange: (query: string) => void
}) {
  return (
    <header className="border-b border-border/60 bg-background/95">
      <div className="flex min-h-16 flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between lg:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
            <WorkflowIcon className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-base font-semibold">Workflows</h1>
              <Badge variant="secondary">{metrics.visibleRequests}</Badge>
            </div>
            <p className="m-0 truncate text-xs text-muted-foreground">
              {viewer?.name ?? 'Authenticated workspace'} · {metrics.externalRequests} external · {metrics.appRequests} app
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <InputGroup className="h-9 border-border/60 bg-card sm:w-80">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              value={query}
              onChange={(event) => onQueryChange(event.currentTarget.value)}
              placeholder="Search workflows, repos, run IDs..."
            />
          </InputGroup>
          <div className="flex items-center gap-1 rounded-md border border-border/50 bg-card p-1">
            <FilterButton active={filter === 'all'} onClick={() => onFilterChange('all')}>
              All
            </FilterButton>
            <FilterButton active={filter === 'needs-review'} onClick={() => onFilterChange('needs-review')}>
              Review
            </FilterButton>
            <FilterButton active={filter === 'running'} onClick={() => onFilterChange('running')}>
              Running
            </FilterButton>
            <FilterButton active={filter === 'queued'} onClick={() => onFilterChange('queued')}>
              Queued
            </FilterButton>
          </div>
          <Sheet>
            <SheetTrigger render={<Button size="sm" />}>
              <PlusIcon data-icon="inline-start" />
              New workflow
            </SheetTrigger>
            <SheetContent className="gap-0 border-border/60 sm:max-w-xl" side="right">
              <SheetHeader className="border-b border-border/60">
                <SheetTitle>New workflow</SheetTitle>
              </SheetHeader>
              <div className="p-4">
                <StartWorkflowPanel />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  )
}

function FilterButton({
  active,
  children,
  onClick,
}: {
  readonly active: boolean
  readonly children: ReactNode
  readonly onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant={active ? 'secondary' : 'ghost'}
      size="sm"
      className="h-7 px-2 text-xs"
      onClick={onClick}
    >
      {children}
    </Button>
  )
}
