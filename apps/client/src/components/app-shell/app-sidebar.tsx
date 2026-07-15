import { useAuth } from '@workos/authkit-tanstack-react-start/client'
import {
  BoxesIcon,
  ClipboardCheckIcon,
  GitBranchIcon,
  LifeBuoyIcon,
  ScrollTextIcon,
  Settings2Icon,
  WorkflowIcon,
} from 'lucide-react'
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

const navMain = [
  {
    title: 'Workflows',
    href: '#overview',
    icon: WorkflowIcon,
    isActive: true,
  },
  { title: 'Reviews', href: '#reviews', icon: ClipboardCheckIcon },
  { title: 'Sources', href: '#repositories', icon: GitBranchIcon },
  { title: 'Sandboxes', href: '#sandboxes', icon: BoxesIcon },
  { title: 'Logs', href: '#logs', icon: ScrollTextIcon },
]

const navSecondary = [
  { title: 'Support', href: '#support', icon: LifeBuoyIcon },
  { title: 'Settings', href: '#settings', icon: Settings2Icon },
]

export function AppSidebar() {
  const { user, signOut } = useAuth()
  const displayName =
    user?.firstName ?? user?.email ?? m.app_operator_fallback()

  return (
    <Sidebar className="border-sidebar-border/60" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              render={<a href="#overview" aria-label="patchplane overview" />}
            >
              <BrandMark className="size-8 shrink-0" />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">patchplane</span>
                <span className="truncate text-xs">Workflow review</span>
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
        displayName={displayName}
        isSignedIn={Boolean(user)}
        onSignOut={() => {
          void signOut()
        }}
      />
      <SidebarRail />
    </Sidebar>
  )
}
