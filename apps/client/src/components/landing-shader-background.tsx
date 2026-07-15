import {
  Component,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import { useTheme } from '@/components/theme-provider'
import ShaderScene from './landing-shader-scene'

export function LandingShaderBackground() {
  const { theme } = useTheme()
  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')
    const resolveTheme = () =>
      setIsDark(theme === 'dark' || (theme === 'system' && colorScheme.matches))

    resolveTheme()
    colorScheme.addEventListener('change', resolveTheme)
    return () => colorScheme.removeEventListener('change', resolveTheme)
  }, [theme])

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[radial-gradient(ellipse_at_3%_10%,rgb(248_174_65/0.62),transparent_48%),radial-gradient(ellipse_at_86%_20%,rgb(38_55_83/0.36),transparent_52%),radial-gradient(ellipse_at_52%_42%,rgb(245_242_240/0.34),transparent_66%),linear-gradient(125deg,rgb(217_199_170/0.38),var(--background)_74%)] dark:bg-[radial-gradient(ellipse_at_3%_10%,rgb(248_174_65/0.38),transparent_48%),radial-gradient(ellipse_at_86%_20%,rgb(38_55_83/0.58),transparent_54%),radial-gradient(ellipse_at_52%_42%,rgb(16_20_33/0.32),transparent_68%),linear-gradient(125deg,rgb(47_33_28/0.74),var(--background)_74%)]"
    >
      <ShaderErrorBoundary>
        <div className="absolute inset-0 opacity-80 motion-reduce:hidden">
          <ShaderScene dark={isDark} />
        </div>
      </ShaderErrorBoundary>
      <div className="absolute inset-0 bg-[rgb(245_242_240/0.18)] dark:bg-[rgb(16_20_33/0.58)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_38%,rgb(245_242_240/0.12)_0%,rgb(245_242_240/0.04)_38%,transparent_68%)] dark:bg-[radial-gradient(ellipse_at_50%_38%,rgb(16_20_33/0.2)_0%,rgb(16_20_33/0.08)_42%,transparent_70%)]" />
    </div>
  )
}

interface ShaderErrorBoundaryProps {
  readonly children: ReactNode
}

interface ShaderErrorBoundaryState {
  readonly failed: boolean
}

class ShaderErrorBoundary extends Component<
  ShaderErrorBoundaryProps,
  ShaderErrorBoundaryState
> {
  state: ShaderErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): ShaderErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // The CSS background remains visible when WebGL initialization fails.
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}
