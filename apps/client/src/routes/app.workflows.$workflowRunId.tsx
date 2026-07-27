import { useEffect } from 'react'
import { Authenticated, AuthLoading, Unauthenticated } from 'convex/react'
import { createFileRoute } from '@tanstack/react-router'
import { AppShellHeader } from '@/components/app-shell/app-shell-header'
import { AppSidebar } from '@/components/app-shell/app-sidebar'
import { LoadingWorkflowDetail } from '@/components/app-shell/loading-workflow-detail'
import { SignedOutWorkflowConsole } from '@/components/app-shell/signed-out-workflow-console'
import { SkipLink } from '@/components/app-shell/skip-link'
import { WorkflowDetailPage } from '@/components/app-shell/workflow-detail-page'
import {
  workflowDiffExpanded,
  workflowDiffFileIndex,
  workflowDiffView,
} from '@/components/app-shell/workflow-diff-navigation'
import { localizeAppHref } from '@/components/app-shell/app-language'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import * as m from '@/paraglide/messages'

const detailTabs = ['summary', 'changes', 'evidence', 'activity'] as const

export const Route = createFileRoute('/app/workflows/$workflowRunId')({
  validateSearch: (search: Record<string, unknown>) => ({
    tab:
      typeof search.tab === 'string' &&
      detailTabs.includes(search.tab as (typeof detailTabs)[number])
        ? (search.tab as (typeof detailTabs)[number])
        : ('summary' as const),
    returnTo:
      typeof search.returnTo === 'string' &&
      (search.returnTo === '/app' || search.returnTo.startsWith('/app?'))
        ? search.returnTo
        : '/app',
    file: workflowDiffFileIndex(search.file),
    diff: workflowDiffView(search.diff),
    focus: workflowDiffExpanded(search.focus) ? ('diff' as const) : undefined,
  }),
  component: WorkflowDetailRoute,
})

function WorkflowDetailRoute() {
  const { workflowRunId } = Route.useParams()
  const { diff, file, focus, tab, returnTo } = Route.useSearch()
  const navigate = Route.useNavigate()

  useEffect(() => {
    document.title = `${m.app_shell_patch_report()} ${workflowRunId} · patchplane`
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('#main-content')?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [workflowRunId])

  return (
    <SidebarProvider>
      <SkipLink />
      <AppSidebar />
      <SidebarInset className="h-svh min-h-0 overflow-hidden">
        <AppShellHeader
          parent={{
            href: localizeAppHref(returnTo),
            label: m.app_nav_workflows(),
          }}
          title={m.app_shell_patch_report()}
        />
        <main
          id="main-content"
          tabIndex={-1}
          aria-label={m.app_shell_patch_report()}
          className="flex min-h-0 flex-1 flex-col overflow-auto outline-none"
        >
          <Authenticated>
            <WorkflowDetailPage
              workflowRunId={workflowRunId}
              tab={tab}
              diffNavigation={{
                expanded: focus === 'diff',
                selectedFileIndex: file,
                view: diff,
              }}
              onRerunCreated={(childWorkflowRunId) => {
                void navigate({
                  to: '/app/workflows/$workflowRunId',
                  params: { workflowRunId: childWorkflowRunId },
                  search: {
                    tab: 'summary',
                    returnTo,
                    file: undefined,
                    diff: 'unified',
                    focus: undefined,
                  },
                })
              }}
              onOpenAttempt={(nextWorkflowRunId) => {
                void navigate({
                  to: '/app/workflows/$workflowRunId',
                  params: { workflowRunId: nextWorkflowRunId },
                  search: {
                    tab: 'summary',
                    returnTo,
                    file: undefined,
                    diff: 'unified',
                    focus: undefined,
                  },
                })
              }}
              onTabChange={(nextTab) => {
                return navigate({
                  search: {
                    tab: nextTab,
                    returnTo,
                    file,
                    diff,
                    focus: nextTab === 'changes' ? focus : undefined,
                  },
                })
              }}
              onDiffNavigationChange={(next) => {
                return navigate({
                  search: {
                    tab: 'changes',
                    returnTo,
                    file: next.selectedFileIndex,
                    diff: next.view,
                    focus: next.expanded ? 'diff' : undefined,
                  },
                })
              }}
            />
          </Authenticated>
          <AuthLoading>
            <LoadingWorkflowDetail tab={tab} />
          </AuthLoading>
          <Unauthenticated>
            <div className="p-4 md:p-6">
              <SignedOutWorkflowConsole />
            </div>
          </Unauthenticated>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
