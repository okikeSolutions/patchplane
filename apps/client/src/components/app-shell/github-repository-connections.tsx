import { useState } from 'react'
import { api } from '@patchplane/backend/convex/_generated/api'
import { usePaginatedQuery } from 'convex/react'
import { ChevronDownIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import * as m from '@/paraglide/messages'
import { getAppLocale, localizeAppHref } from './app-language'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

function GitHubLogo({ className }: { readonly className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 1024 1024"
      fill="none"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M512 0C229.12 0 0 229.12 0 512c0 226.56 146.56 417.92 350.08 485.76 25.6 4.48 35.2-10.88 35.2-24.32 0-12.16-.64-52.48-.64-95.36-128.64 23.68-161.92-31.36-172.16-60.16-5.76-14.72-30.72-60.16-52.48-72.32-17.92-9.6-43.52-33.28-.64-33.92 40.32-.64 69.12 37.12 78.72 52.48 46.08 77.44 119.68 55.68 149.12 42.24 4.48-33.28 17.92-55.68 32.64-68.48-113.92-12.8-232.96-56.96-232.96-252.8 0-55.68 19.84-101.76 52.48-137.6-5.12-12.8-23.04-65.28 5.12-135.68 0 0 42.88-13.44 140.8 52.48 40.96-11.52 84.48-17.28 128-17.28s87.04 5.76 128 17.28c97.92-66.56 140.8-52.48 140.8-52.48 28.16 70.4 10.24 122.88 5.12 135.68 32.64 35.84 52.48 81.28 52.48 137.6 0 196.48-119.68 240-233.6 252.8 18.56 16 34.56 46.72 34.56 94.72 0 68.48-.64 123.52-.64 140.8 0 13.44 9.6 29.44 35.2 24.32C877.44 929.92 1024 737.92 1024 512 1024 229.12 794.88 0 512 0"
        clipRule="evenodd"
      />
    </svg>
  )
}

type VerificationStatus =
  | 'queued'
  | 'running'
  | 'reviewed'
  | 'approved'
  | 'rejected'
  | 'changes-requested'
  | 'manual-review'
  | 'failed'

interface ConnectedRepositoryRow {
  repository: {
    id: string
    repositoryFullName: string
    status: 'active' | 'suspended' | 'removed' | 'reconnect_required'
    private: boolean
  }
  latestVerification?: {
    workflowRunId: string
    workflowStatus: 'queued' | 'running' | 'reviewed' | 'failed'
    verificationStatus: VerificationStatus
    pullRequestNumber?: number
    url?: string
    createdAt: number
    updatedAt: number
  }
}

function verificationLabel(status: VerificationStatus) {
  const labels: Readonly<Record<VerificationStatus, () => string>> = {
    queued: m.app_status_queued,
    running: m.app_status_running,
    reviewed: m.app_status_reviewed,
    approved: m.app_status_approved,
    rejected: m.app_status_rejected,
    'changes-requested': m.app_status_changes_requested,
    'manual-review': m.app_status_manual_review,
    failed: m.app_status_execution_failed,
  }
  return labels[status]()
}

export function GitHubRepositoryConnections({
  workspaceId,
}: {
  readonly workspaceId: string | undefined
}) {
  const [open, setOpen] = useState(false)
  const {
    results: repositories,
    status: paginationStatus,
    loadMore,
  } = usePaginatedQuery(
    api.connectedRepositories.listForWorkspaceWithLatestVerification,
    workspaceId === undefined ? 'skip' : { workspaceId },
    { initialNumItems: 20 },
  ) as {
    readonly results: ReadonlyArray<ConnectedRepositoryRow>
    readonly status:
      | 'LoadingFirstPage'
      | 'CanLoadMore'
      | 'LoadingMore'
      | 'Exhausted'
    readonly loadMore: (numItems: number) => void
  }

  return (
    <Card className="shrink-0 rounded-none border-x-0 border-t-0 border-border bg-card/65 py-0 shadow-none ring-0">
      <CardHeader className="gap-2 px-4 py-3 lg:px-6">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
          <div className="min-w-0">
            <CardTitle as="h2" className="flex items-center gap-2 text-sm">
              <GitHubLogo className="size-4" />
              {m.app_github_repositories()}
            </CardTitle>
            <CardDescription className="break-words [overflow-wrap:anywhere]">
              {repositories.length === 0
                ? m.app_github_connect_intro()
                : `${repositories.length} ${m.app_github_connected()} ${repositories.length === 1 ? m.app_github_repository() : m.app_github_repositories_plural()} · ${m.app_github_status_glance()}`}
            </CardDescription>
          </div>
          {workspaceId === undefined ? (
            <Button
              type="button"
              size="sm"
              className="min-h-11 w-full sm:w-auto md:min-h-8"
              disabled
            >
              {m.app_github_connect()}
            </Button>
          ) : (
            <a
              className={buttonVariants({
                size: 'sm',
                className: 'min-h-11 w-full sm:w-auto md:min-h-8',
              })}
              href={`/api/github/install/start?returnPathname=${encodeURIComponent(localizeAppHref('/app'))}`}
            >
              {repositories.length === 0
                ? m.app_github_connect()
                : m.app_github_manage()}
            </a>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3 lg:px-6">
        {workspaceId === undefined ? (
          <p className="text-sm text-muted-foreground">
            {m.app_github_requires_org()}
          </p>
        ) : paginationStatus === 'LoadingFirstPage' ? (
          <output
            aria-live="polite"
            className="block text-sm text-muted-foreground"
          >
            {m.app_github_loading()}
          </output>
        ) : repositories.length === 0 ? (
          <output className="block text-sm text-muted-foreground">
            {m.app_github_empty()}
          </output>
        ) : (
          <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mb-1 min-h-11 px-2 md:min-h-8"
                />
              }
            >
              {open
                ? m.app_github_hide()
                : `${m.app_github_show()} ${repositories.length} ${repositories.length === 1 ? m.app_github_repository() : m.app_github_repositories_plural()}`}
              <ChevronDownIcon
                className={cn('transition-transform', open && 'rotate-180')}
                data-icon="inline-end"
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-1">
              <ScrollArea className="max-h-64">
                <div className="grid gap-2 pr-2">
                  {repositories.map(({ repository, latestVerification }) => (
                    <div
                      key={repository.id}
                      className="flex flex-col items-start gap-3 rounded-md border border-border px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:py-2"
                    >
                      <div className="min-w-0">
                        <p className="break-words text-sm font-medium [overflow-wrap:anywhere]">
                          {repository.repositoryFullName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {repository.private
                            ? m.app_github_private()
                            : m.app_github_public()}
                        </p>
                        {latestVerification === undefined ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {m.app_github_no_verification()}
                          </p>
                        ) : (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {m.app_github_latest_verification()}
                            {latestVerification.pullRequestNumber === undefined
                              ? ''
                              : ` · PR #${latestVerification.pullRequestNumber}`}
                            {' · '}
                            <time
                              dateTime={new Date(
                                latestVerification.updatedAt,
                              ).toISOString()}
                            >
                              {new Date(
                                latestVerification.updatedAt,
                              ).toLocaleString(getAppLocale())}
                            </time>
                            {' · '}
                            <a
                              className="font-medium text-foreground underline-offset-4 hover:underline"
                              data-latest-verification-status={
                                latestVerification.verificationStatus
                              }
                              data-latest-verification-workflow-run-id={
                                latestVerification.workflowRunId
                              }
                              href={localizeAppHref(
                                `/app/workflows/${encodeURIComponent(latestVerification.workflowRunId)}`,
                              )}
                            >
                              {m.app_github_view_run()}
                            </a>
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-row flex-wrap items-start gap-1 sm:flex-col sm:items-end">
                        <Badge
                          variant={
                            repository.status === 'active'
                              ? 'secondary'
                              : 'outline'
                          }
                        >
                          {repository.status === 'active'
                            ? m.app_github_connected()
                            : m.app_github_reconnect()}
                        </Badge>
                        {latestVerification === undefined ? null : (
                          <Badge variant="outline">
                            {verificationLabel(
                              latestVerification.verificationStatus,
                            )}
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                  {paginationStatus === 'CanLoadMore' ||
                  paginationStatus === 'LoadingMore' ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="min-h-11 w-full sm:w-fit md:min-h-8"
                      aria-busy={paginationStatus === 'LoadingMore'}
                      disabled={paginationStatus === 'LoadingMore'}
                      onClick={() => loadMore(20)}
                    >
                      {paginationStatus === 'LoadingMore'
                        ? m.app_loading()
                        : m.app_github_load_more()}
                    </Button>
                  ) : null}
                </div>
              </ScrollArea>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  )
}
