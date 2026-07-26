import { useRouter } from '@tanstack/react-router'
import {
  createContext,
  type PropsWithChildren,
  use,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react'
import type { T as Theme } from '@/lib/theme'

type ThemeContextVal = { theme: Theme; setTheme: (val: Theme) => void }
type Props = PropsWithChildren<{
  theme: Theme
  persistence?: 'local' | 'server'
  persistTheme?: (theme: Theme) => Promise<unknown>
}>

const ThemeContext = createContext<ThemeContextVal | null>(null)

function getSystemTheme(): Exclude<Theme, 'system'> {
  if (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  ) {
    return 'dark'
  }

  return 'light'
}

function applyTheme(theme: Theme) {
  const resolvedTheme = theme === 'system' ? getSystemTheme() : theme
  const root = document.documentElement

  root.classList.remove('light', 'dark', 'system')
  root.classList.add(resolvedTheme)
}

const localThemeKey = 'patchplane-theme'
const localThemeChangeEvent = 'patchplane-theme-change'

function localThemeSnapshot(fallback: Theme): Theme {
  const storedTheme = window.localStorage.getItem(localThemeKey)
  return storedTheme === 'light' || storedTheme === 'dark' || storedTheme === 'system'
    ? storedTheme
    : fallback
}

function subscribeToLocalTheme(onStoreChange: () => void) {
  window.addEventListener('storage', onStoreChange)
  window.addEventListener(localThemeChangeEvent, onStoreChange)
  return () => {
    window.removeEventListener('storage', onStoreChange)
    window.removeEventListener(localThemeChangeEvent, onStoreChange)
  }
}

export function ThemeProvider({
  children,
  theme,
  persistence = 'server',
  persistTheme,
}: Props) {
  const router = useRouter()
  const [optimisticServerTheme, setOptimisticServerTheme] = useState<Theme>()
  const localTheme = useSyncExternalStore(
    subscribeToLocalTheme,
    () => localThemeSnapshot(theme),
    () => theme,
  )
  const currentTheme = persistence === 'local'
    ? localTheme
    : optimisticServerTheme ?? theme

  useEffect(() => {
    applyTheme(currentTheme)

    if (currentTheme !== 'system') {
      return undefined
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = () => applyTheme('system')

    mediaQuery.addEventListener('change', listener)
    return () => mediaQuery.removeEventListener('change', listener)
  }, [currentTheme])

  function setTheme(val: Theme) {
    if (persistence === 'local') {
      window.localStorage.setItem(localThemeKey, val)
      window.dispatchEvent(new Event(localThemeChangeEvent))
      return
    }

    if (persistTheme === undefined) {
      throw new Error('Server theme persistence requires persistTheme')
    }

    setOptimisticServerTheme(val)
    void persistTheme(val)
      .then(() => router.invalidate())
      .finally(() => setOptimisticServerTheme(undefined))
  }

  return (
    <ThemeContext value={{ theme: currentTheme, setTheme }}>
      {children}
    </ThemeContext>
  )
}

export function useTheme() {
  const val = use(ThemeContext)
  if (!val) throw new Error('useTheme called outside of ThemeProvider!')
  return val
}
