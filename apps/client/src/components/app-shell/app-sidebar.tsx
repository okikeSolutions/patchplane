import { useAuth } from '@workos/authkit-tanstack-react-start/client'
import {
  BoxesIcon,
  ClipboardCheckIcon,
  GitBranchIcon,
  LifeBuoyIcon,
  ScrollTextIcon,
  Settings2Icon,
  ShieldCheckIcon,
  WorkflowIcon,
} from 'lucide-react'
import * as m from '@/paraglide/messages'
import { NavMain } from './nav-main'
import { NavSecondary } from './nav-secondary'
import { NavUser } from './nav-user'
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
  { title: 'Trust model', href: '/about', icon: ShieldCheckIcon },
  { title: 'Support', href: '#support', icon: LifeBuoyIcon },
  { title: 'Settings', href: '#settings', icon: Settings2Icon },
]

export function AppSidebar() {
  const { user, signOut } = useAuth()
  const displayName = user?.firstName ?? user?.email ?? m.app_operator_fallback()

  return (
    <Sidebar className="border-sidebar-border/60" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              render={<a href="#overview" aria-label="PatchPlane overview" />}
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg border border-sidebar-border/40 bg-sidebar-primary/10 shadow-[0_0_24px_rgb(255_169_72/0.22)]">
                <span className="size-3 rounded-full bg-[linear-gradient(135deg,rgb(255_144_52),rgb(255_209_122))] shadow-[0_0_18px_rgb(255_169_72/0.6)]" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">PatchPlane</span>
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
