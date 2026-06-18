import { LogOutIcon, ShieldCheckIcon } from 'lucide-react'
import LocaleSwitcher from '@/components/locale-switcher'
import { ModeToggle } from '@/components/mode-toggle'
import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

export function NavUser({
  displayName,
  isSignedIn,
  onSignOut,
}: {
  readonly displayName: string
  readonly isSignedIn: boolean
  readonly onSignOut: () => void
}) {
  return (
    <SidebarFooter>
      <div className="flex items-center gap-2 px-2 group-data-[collapsible=icon]:flex-col">
        <LocaleSwitcher />
        <ModeToggle />
      </div>
      <SidebarMenu>
        <SidebarMenuItem>
          {isSignedIn ? (
            <SidebarMenuButton tooltip="Sign out" onClick={onSignOut}>
              <LogOutIcon />
              <span className="truncate">{displayName}</span>
            </SidebarMenuButton>
          ) : (
            <SidebarMenuButton
              render={
                <a
                  href="/api/auth/sign-in?returnPathname=/app"
                  aria-label="Sign in"
                />
              }
            >
              <ShieldCheckIcon />
              <span>Sign in</span>
            </SidebarMenuButton>
          )}
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  )
}
