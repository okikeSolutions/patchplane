import { useAuth } from '@workos/authkit-tanstack-react-start/client'
import { BookOpenIcon, GitBranchIcon, WorkflowIcon } from 'lucide-react'
import * as m from '@/paraglide/messages'
import { NavMain } from './nav-main'
import { NavSecondary } from './nav-secondary'
import { NavUser } from './nav-user'
import { BrandMark } from '@/components/brand-logo'
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'
import { localizeAppHref } from './app-language'

export function AppSidebar() {
  const { user, signOut } = useAuth()
  const navMain = [
    {
      title: m.app_nav_workflows(),
      href: localizeAppHref('/app'),
      icon: WorkflowIcon,
      isActive: true,
    },
  ]
  const navSecondary = [
    {
      title: m.app_nav_documentation(),
      href: 'https://github.com/okikeSolutions/patchplane#readme',
      icon: BookOpenIcon,
    },
    {
      title: 'GitHub',
      href: 'https://github.com/okikeSolutions/patchplane',
      icon: GitBranchIcon,
    },
  ]

  return (
    <Sidebar className="border-sidebar-border/60" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              tooltip={m.app_nav_patchplane_workflows()}
              render={
                <a
                  href={localizeAppHref('/app')}
                  aria-label={m.app_nav_patchplane_workflows()}
                />
              }
            >
              <BrandMark className="size-8 shrink-0" />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">patchplane</span>
                <span className="truncate text-xs">
                  {m.app_nav_patch_reports()}
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
        <NavSecondary items={navSecondary} className="mt-auto" />
      </SidebarContent>
      <NavUser
        isSignedIn={Boolean(user)}
        onSignOut={() => {
          void signOut()
        }}
      />
      <SidebarRail />
    </Sidebar>
  )
}
