import { createFileRoute, redirect } from '@tanstack/react-router'
import { AppWorkflowConsolePage } from '@/components/app-shell/app-workflow-console-page'
import { getInitialAuthServerFn } from '@/lib/workos-initial-auth'

export const Route = createFileRoute('/app')({
  beforeLoad: async ({ location }) => {
    const auth = await getInitialAuthServerFn()
    if (auth.user) return

    const returnPathname = encodeURIComponent(location.href)
    throw redirect({
      href: `/api/auth/sign-in?returnPathname=${returnPathname}`,
    })
  },
  component: AppWorkflowConsolePage,
})
