import type { ReactNode } from 'react'
import { PlusIcon, SearchIcon, WorkflowIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { StartWorkflowPanel } from './start-workflow-panel'
import type { ViewerIdentity } from './types'
import type { WorkflowFilter } from './workflow-console-model'

export function WorkflowConsoleToolbar({
  filter,
  metrics,
  query,
  repositories,
  repository,
  viewer,
  onFilterChange,
  onQueryChange,
  onRepositoryChange,
}: {
  readonly filter: WorkflowFilter
  readonly metrics: {
    readonly visibleRequests: number
    readonly appRequests: number
    readonly externalRequests: number
  }
  readonly query: string
  readonly repositories: ReadonlyArray<string>
  readonly repository: string
  readonly viewer: ViewerIdentity | undefined
  readonly onFilterChange: (filter: WorkflowFilter) => void
  readonly onQueryChange: (query: string) => void
  readonly onRepositoryChange: (repository: string) => void
}) {
  return (
    <header className="border-b border-border bg-background/95">
      <div className="flex min-h-16 flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between lg:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/80 text-muted-foreground">
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
          <label className="sr-only" htmlFor="workflow-repository">Repository scope</label>
          <NativeSelect id="workflow-repository" value={repository} onChange={(event) => onRepositoryChange(event.currentTarget.value)} className="h-9 sm:w-52">
            <NativeSelectOption value="all">All repositories</NativeSelectOption>
            {repositories.map((name) => <NativeSelectOption key={name} value={name}>{name}</NativeSelectOption>)}
          </NativeSelect>
          <label className="sr-only" htmlFor="workflow-search">Search workflows</label>
          <InputGroup className="h-9 border-border bg-card sm:w-80">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              id="workflow-search"
              value={query}
              onChange={(event) => onQueryChange(event.currentTarget.value)}
              placeholder="Search workflows, repos, run IDs..."
            />
          </InputGroup>
          <fieldset className="flex max-w-full items-center gap-1 overflow-x-auto rounded-md border border-border bg-card p-1">
            <legend className="sr-only">Filter workflows by trust state</legend>
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
            <FilterButton active={filter === 'sandbox-failed'} onClick={() => onFilterChange('sandbox-failed')}>
              Failed
            </FilterButton>
            <FilterButton active={filter === 'approved'} onClick={() => onFilterChange('approved')}>
              Approved
            </FilterButton>
          </fieldset>
          <Sheet>
            <SheetTrigger render={<Button size="sm" />}>
              <PlusIcon data-icon="inline-start" />
              New workflow
            </SheetTrigger>
            <SheetContent className="gap-0 border-border sm:max-w-xl" side="right">
              <SheetHeader className="border-b border-border">
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
      aria-pressed={active}
      variant={active ? 'secondary' : 'ghost'}
      size="sm"
      className="h-7 px-2 text-xs"
      onClick={onClick}
    >
      {children}
    </Button>
  )
}
