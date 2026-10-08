import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
export const Route = createFileRoute('/app')({
  beforeLoad: ({ context, location }) => {
    if (context.initialAuth.user) return

    const returnPathname = encodeURIComponent(location.href)
    throw redirect({
      href: `/api/auth/sign-in?returnPathname=${returnPathname}`,
    })
  },
  component: Outlet,
})
