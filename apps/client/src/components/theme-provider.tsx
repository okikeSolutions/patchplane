import { ScriptOnce } from '@tanstack/react-router'
import {
  createContext,
  type PropsWithChildren,
  use,
  useEffect,
  useLayoutEffect,
  useRef,
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
const localThemeKey = 'patchplane-theme'
const localThemeChangeEvent = 'patchplane-theme-change'

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
  root.style.colorScheme = resolvedTheme
}

export function createThemeBootstrapScript(
  theme: Theme,
  persistence: Props['persistence'] = 'server',
) {
  const fallback = JSON.stringify(theme)
  const storedTheme =
    persistence === 'local'
      ? `localStorage.getItem(${JSON.stringify(localThemeKey)})`
      : fallback

  return `(function(){try{var t=${storedTheme};if(t!=='light'&&t!=='dark'&&t!=='system'){t=${fallback}}var d=matchMedia('(prefers-color-scheme: dark)').matches;var r=t==='system'?(d?'dark':'light'):t;var e=document.documentElement;e.classList.remove('light','dark','system');e.classList.add(r);e.style.colorScheme=r}catch(e){}})();`
}

function localThemeSnapshot(fallback: Theme): Theme {
  const storedTheme = window.localStorage.getItem(localThemeKey)
  return storedTheme === 'light' ||
    storedTheme === 'dark' ||
    storedTheme === 'system'
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
  const [optimisticServerTheme, setOptimisticServerTheme] = useState<Theme>()
  const persistenceRequest = useRef(0)
  const localTheme = useSyncExternalStore(
    subscribeToLocalTheme,
    () => localThemeSnapshot(theme),
    () => theme,
  )
  const currentTheme =
    persistence === 'local' ? localTheme : (optimisticServerTheme ?? theme)

  useLayoutEffect(() => {
    applyTheme(currentTheme)
  }, [currentTheme])

  useEffect(() => {
    if (currentTheme !== 'system') {
      return undefined
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = () => applyTheme('system')

    mediaQuery.addEventListener('change', listener)
    return () => mediaQuery.removeEventListener('change', listener)
  }, [currentTheme])

  function setTheme(val: Theme) {
    if (val === currentTheme) return
    applyTheme(val)

    if (persistence === 'local') {
      window.localStorage.setItem(localThemeKey, val)
      window.dispatchEvent(new Event(localThemeChangeEvent))
      return
    }

    if (persistTheme === undefined) {
      throw new Error('Server theme persistence requires persistTheme')
    }

    const request = persistenceRequest.current + 1
    persistenceRequest.current = request
    setOptimisticServerTheme(val)
    void persistTheme(val).catch(() => {
      if (persistenceRequest.current === request) {
        setOptimisticServerTheme(undefined)
      }
    })
  }

  return (
    <ThemeContext value={{ theme: currentTheme, setTheme }}>
      <ScriptOnce>{createThemeBootstrapScript(theme, persistence)}</ScriptOnce>
      {children}
    </ThemeContext>
  )
}

export function useTheme() {
  const val = use(ThemeContext)
  if (!val) throw new Error('useTheme called outside of ThemeProvider!')
  return val
}
