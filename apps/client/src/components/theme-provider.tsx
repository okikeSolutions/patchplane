import { useRouter } from '@tanstack/react-router'
import {
  createContext,
  type PropsWithChildren,
  use,
  useEffect,
  useState,
} from 'react'
import { setThemeServerFn, type T as Theme } from '@/lib/theme'

type ThemeContextVal = { theme: Theme; setTheme: (val: Theme) => void }
type Props = PropsWithChildren<{ theme: Theme }>

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

export function ThemeProvider({ children, theme }: Props) {
  const router = useRouter()
  const [currentTheme, setCurrentTheme] = useState(theme)

  useEffect(() => {
    setCurrentTheme(theme)
  }, [theme])

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
    void setThemeServerFn({ data: val }).then(() => router.invalidate())
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
