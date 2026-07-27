import { LogOutIcon, ShieldCheckIcon } from 'lucide-react'
import * as m from '@/paraglide/messages'
import LocaleSwitcher from '@/components/locale-switcher'
import { ModeToggle } from '@/components/mode-toggle'
import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { localizeAppHref } from './app-language'

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
            <SidebarMenuButton
              className="min-h-11 md:min-h-8"
              tooltip={m.app_nav_sign_out()}
              onClick={onSignOut}
            >
              <LogOutIcon />
              <span className="truncate">{displayName}</span>
            </SidebarMenuButton>
          ) : (
            <SidebarMenuButton
              className="min-h-11 md:min-h-8"
              tooltip={m.app_sign_in()}
              render={
                <a
                  href={`/api/auth/sign-in?returnPathname=${encodeURIComponent(localizeAppHref('/app'))}`}
                  aria-label={m.app_sign_in()}
                />
              }
            >
              <ShieldCheckIcon />
              <span>{m.app_sign_in()}</span>
            </SidebarMenuButton>
          )}
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  )
}
