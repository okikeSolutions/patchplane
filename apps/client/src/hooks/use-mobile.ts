import * as React from "react"

const MOBILE_BREAKPOINT = 768
const mobileQuery = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribeToMobileViewport(onStoreChange: () => void) {
  const mediaQuery = window.matchMedia(mobileQuery)
  mediaQuery.addEventListener("change", onStoreChange)
  return () => mediaQuery.removeEventListener("change", onStoreChange)
}

function mobileViewportSnapshot() {
  return window.matchMedia(mobileQuery).matches
}

export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribeToMobileViewport,
    mobileViewportSnapshot,
    () => false,
  )
}
