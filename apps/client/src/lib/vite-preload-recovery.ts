const reloadGuardKey = 'patchplane:vite-preload-reload-at'
const reloadGuardWindowMs = 60_000

interface VitePreloadErrorEvent extends Event {
  readonly payload?: unknown
}

interface PreloadRecoveryTarget {
  readonly sessionStorage: Storage
  readonly location: Pick<Location, 'reload'>
  addEventListener(type: string, listener: EventListener): void
  removeEventListener(type: string, listener: EventListener): void
}

function recentlyAttemptedRecovery(storage: Storage, now: number) {
  const storedValue = storage.getItem(reloadGuardKey)
  if (storedValue === null) return false
  const value = Number(storedValue)
  return Number.isFinite(value) && now - value < reloadGuardWindowMs
}

export function installVitePreloadErrorRecovery(
  target: PreloadRecoveryTarget = window,
  now: () => number = Date.now,
) {
  const recover = (event: Event) => {
    const preloadEvent = event as VitePreloadErrorEvent

    try {
      if (recentlyAttemptedRecovery(target.sessionStorage, now())) return
      target.sessionStorage.setItem(reloadGuardKey, String(now()))
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }

    preloadEvent.preventDefault()
    target.location.reload()
  }

  target.addEventListener('vite:preloadError', recover)
  return () => target.removeEventListener('vite:preloadError', recover)
}
