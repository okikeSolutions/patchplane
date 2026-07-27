import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import * as m from '@/paraglide/messages'
import {
  activeAppVersionFrom,
  type AppVersionId,
  isNewAppVersion,
} from '@/lib/app-version'

const appVersionQueryKey = ['app-version'] as const
const appVersionToastId = 'app-version-update'
const appVersionRefetchIntervalMs = 5 * 60 * 1_000

async function fetchActiveAppVersion() {
  const response = await fetch('/api/version', {
    cache: 'no-store',
    headers: { accept: 'application/json' },
  })
  if (!response.ok) {
    throw new Error(`Version check failed with status ${response.status}`)
  }
  return activeAppVersionFrom(await response.json())
}

export function AppVersionNotifier({
  bootVersionId,
}: {
  readonly bootVersionId: AppVersionId
}) {
  const initialVersionId = useRef(bootVersionId)
  const activeVersion = useQuery({
    queryKey: appVersionQueryKey,
    queryFn: fetchActiveAppVersion,
    refetchInterval: appVersionRefetchIntervalMs,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 0,
  })
  const activeVersionId = activeVersion.data?.versionId

  useEffect(() => {
    if (
      activeVersionId === undefined ||
      !isNewAppVersion(initialVersionId.current, activeVersionId)
    ) {
      return
    }

    toast.info(m.app_update_available_title(), {
      id: appVersionToastId,
      description: m.app_update_available_description(),
      duration: Infinity,
      action: {
        label: m.app_update_reload(),
        onClick: () => window.location.reload(),
      },
    })
  }, [activeVersionId])

  return null
}
