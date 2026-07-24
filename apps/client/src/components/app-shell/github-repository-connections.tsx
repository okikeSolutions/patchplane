import { api } from '@patchplane/backend/convex/_generated/api'
import { usePaginatedQuery } from 'convex/react'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
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

interface ConnectedRepositoryRow {
  repository: {
    id: string
    repositoryFullName: string
    status: 'active' | 'suspended' | 'removed' | 'reconnect_required'
    private: boolean
  }
  latestVerification?: {
    workflowRunId: string
    workflowStatus: 'queued' | 'running' | 'reviewed'
    verificationStatus: VerificationStatus
    pullRequestNumber?: number
    url?: string
    createdAt: number
    updatedAt: number
  }
}

const verificationLabels: Readonly<Record<VerificationStatus, string>> = {
  queued: 'Queued',
  running: 'Running',
  reviewed: 'Reviewed',
  approved: 'Approved',
  rejected: 'Rejected',
  'changes-requested': 'Changes requested',
  'manual-review': 'Manual review',
}

export function GitHubRepositoryConnections({
  workspaceId,
}: {
  readonly workspaceId: string | undefined
}) {
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
    <Card className="border-border/60 bg-card/80 shadow-none">
      <CardHeader className="gap-2 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-sm">
              <GitHubLogo className="size-4" />
              GitHub repositories
            </CardTitle>
            <CardDescription>
              Connect a GitHub App installation so patchplane can route PR
              events to this workspace.
            </CardDescription>
          </div>
          <a
            aria-disabled={workspaceId === undefined}
            className={cn(
              buttonVariants({ size: 'sm' }),
              workspaceId === undefined && 'pointer-events-none opacity-50',
            )}
            href="/api/github/install/start?returnPathname=/app"
          >
            Connect GitHub
          </a>
        </div>
      </CardHeader>
      <CardContent>
        {workspaceId === undefined ? (
          <p className="text-sm text-muted-foreground">
            Select an active WorkOS organization before connecting GitHub.
          </p>
        ) : paginationStatus === 'LoadingFirstPage' ? (
          <p className="text-sm text-muted-foreground">Loading repositories…</p>
        ) : repositories.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No repositories connected yet. Connect GitHub to start routing PR
            verification workflows.
          </p>
        ) : (
          <div className="grid gap-2">
            {repositories.map(({ repository, latestVerification }) => (
              <div
                key={repository.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {repository.repositoryFullName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {repository.private
                      ? 'Private repository'
                      : 'Public repository'}
                  </p>
                  {latestVerification === undefined ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      No verification run yet
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Latest verification
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
                        ).toLocaleString()}
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
                        href={`/app/workflows/${encodeURIComponent(latestVerification.workflowRunId)}`}
                      >
                        View run
                      </a>
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge
                    variant={
                      repository.status === 'active' ? 'secondary' : 'outline'
                    }
                  >
                    {repository.status === 'active'
                      ? 'Connected'
                      : 'Reconnect required'}
                  </Badge>
                  {latestVerification === undefined ? null : (
                    <Badge variant="outline">
                      {
                        verificationLabels[
                          latestVerification.verificationStatus
                        ]
                      }
                    </Badge>
                  )}
                </div>
              </div>
            ))}
            {paginationStatus === 'CanLoadMore' ||
            paginationStatus === 'LoadingMore' ? (
              <Button
                type="button"
                variant="outline"
                disabled={paginationStatus === 'LoadingMore'}
                onClick={() => loadMore(20)}
              >
                {paginationStatus === 'LoadingMore'
                  ? 'Loading repositories…'
                  : 'Load more repositories'}
              </Button>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
