import { useRouter } from '@tanstack/react-router'
import {
  createContext,
  type PropsWithChildren,
  use,
  useEffect,
  useState,
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

export function ThemeProvider({
  children,
  theme,
  persistence = 'server',
  persistTheme,
}: Props) {
  const router = useRouter()
  const [currentTheme, setCurrentTheme] = useState(theme)

  useEffect(() => {
    setCurrentTheme(theme)
  }, [theme])

  useEffect(() => {
    if (persistence === 'local') {
      const storedTheme = window.localStorage.getItem(localThemeKey)
      if (
        storedTheme === 'light' ||
        storedTheme === 'dark' ||
        storedTheme === 'system'
      ) {
        setCurrentTheme(storedTheme)
      }
    }
  }, [persistence])

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
    setCurrentTheme(val)
    if (persistence === 'local') {
      window.localStorage.setItem(localThemeKey, val)
      return
    }

    if (persistTheme === undefined) {
      throw new Error('Server theme persistence requires persistTheme')
    }

    void persistTheme(val).then(() => router.invalidate())
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
