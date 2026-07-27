import { PlusIcon, SearchIcon, WorkflowIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import * as m from '@/paraglide/messages'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
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
      <div className="flex min-h-16 flex-col gap-3 px-4 py-3 lg:px-6 2xl:flex-row 2xl:items-center 2xl:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/80 text-muted-foreground">
            <WorkflowIcon className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div
                aria-hidden="true"
                className="break-words text-base font-semibold"
              >
                {m.app_nav_workflows()}
              </div>
              <Badge variant="secondary" aria-hidden="true">
                {metrics.visibleRequests}
              </Badge>
              <span className="sr-only">
                {metrics.visibleRequests} {m.app_queue_workspace_count()}
              </span>
            </div>
            <p className="m-0 break-words text-xs text-muted-foreground">
              {viewer?.name ?? m.app_queue_authenticated_workspace()} ·{' '}
              {metrics.externalRequests} external · {metrics.appRequests} app
            </p>
          </div>
        </div>
        <div className="grid w-full min-w-0 grid-cols-1 gap-2 sm:grid-cols-[13rem_minmax(0,1fr)_auto] 2xl:w-auto 2xl:grid-cols-[13rem_20rem_auto_minmax(0,1fr)]">
          <label className="sr-only" htmlFor="workflow-repository">
            {m.app_queue_repository_scope()}
          </label>
          <NativeSelect
            id="workflow-repository"
            value={repository}
            onChange={(event) => onRepositoryChange(event.currentTarget.value)}
            className="h-11 w-full [&_select]:h-11 md:h-9 md:[&_select]:h-9"
          >
            <NativeSelectOption value="all">
              {m.app_queue_all_repositories()}
            </NativeSelectOption>
            {repositories.map((name) => (
              <NativeSelectOption key={name} value={name}>
                {name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <label className="sr-only" htmlFor="workflow-search">
            {m.app_queue_search()}
          </label>
          <InputGroup className="h-11 w-full border-border bg-card md:h-9">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              id="workflow-search"
              value={query}
              onChange={(event) => onQueryChange(event.currentTarget.value)}
              placeholder={m.app_queue_search_placeholder()}
            />
          </InputGroup>
          <Sheet>
            <SheetTrigger
              render={
                <Button
                  size="sm"
                  className="min-h-11 w-full sm:w-auto md:min-h-9"
                />
              }
            >
              <PlusIcon data-icon="inline-start" />
              {m.app_queue_new_workflow()}
            </SheetTrigger>
            <SheetContent
              className="!w-full gap-0 overflow-y-auto overscroll-contain border-border sm:!max-w-xl"
              side="right"
            >
              <SheetHeader className="border-b border-border">
                <SheetTitle>{m.app_queue_new_workflow()}</SheetTitle>
              </SheetHeader>
              <div className="p-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
                <StartWorkflowPanel />
              </div>
            </SheetContent>
          </Sheet>
          <ToggleGroup
            aria-label={m.app_queue_filter_label()}
            value={[filter]}
            size="sm"
            spacing={0}
            className="min-w-0 max-w-full flex-wrap bg-card p-1 sm:col-span-3 2xl:col-span-1"
            onValueChange={(values) => {
              const selected = filterOptions().find(
                ({ value }) => value === values[0],
              )
              if (selected !== undefined) {
                onFilterChange(selected.value)
              }
            }}
          >
            {filterOptions().map(({ label, value }) => (
              <ToggleGroupItem
                key={value}
                value={value}
                className="min-h-10 px-3 text-xs md:min-h-8 md:px-2"
              >
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>
    </header>
  )
}

function filterOptions(): ReadonlyArray<{
  readonly label: string
  readonly value: WorkflowFilter
}> {
  return [
    { value: 'all', label: m.app_queue_filter_all() },
    { value: 'needs-review', label: m.app_queue_filter_review() },
    { value: 'running', label: m.app_queue_filter_running() },
    { value: 'queued', label: m.app_queue_filter_queued() },
    { value: 'sandbox-failed', label: m.app_queue_filter_failed() },
    { value: 'approved', label: m.app_queue_filter_approved() },
  ]
}
