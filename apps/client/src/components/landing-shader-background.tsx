import {
  Component,
  useLayoutEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import { useTheme } from '@/components/theme-provider'
import ShaderScene from './landing-shader-scene'

export function LandingShaderBackground() {
  const { theme } = useTheme()
  const [canRender, setCanRender] = useState(false)
  const [isDark, setIsDark] = useState(false)
  const [isShaderReady, setIsShaderReady] = useState(false)

  useLayoutEffect(() => {
    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const resolveTheme = () =>
      setIsDark(theme === 'dark' || (theme === 'system' && colorScheme.matches))

    resolveTheme()
    setCanRender(!reducedMotion.matches && 'WebGLRenderingContext' in window)

    colorScheme.addEventListener('change', resolveTheme)
    return () => colorScheme.removeEventListener('change', resolveTheme)
  }, [theme])

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[radial-gradient(ellipse_at_4%_12%,rgb(248_174_65/0.58),transparent_48%),radial-gradient(ellipse_at_88%_22%,rgb(38_55_83/0.34),transparent_50%),linear-gradient(125deg,rgb(217_199_170/0.34),var(--background)_72%)] dark:bg-[radial-gradient(ellipse_at_4%_12%,rgb(248_174_65/0.34),transparent_48%),radial-gradient(ellipse_at_88%_22%,rgb(38_55_83/0.54),transparent_54%),linear-gradient(125deg,rgb(47_33_28/0.72),var(--background)_72%)]"
    >
      {canRender ? (
        <ShaderErrorBoundary>
          <div
            className={
              isShaderReady
                ? 'absolute inset-0 opacity-90 transition-opacity duration-700 ease-out will-change-opacity motion-reduce:transition-none dark:opacity-80'
                : 'absolute inset-0 opacity-0 transition-opacity duration-700 ease-out will-change-opacity motion-reduce:transition-none'
            }
          >
            <ShaderScene dark={isDark} onReady={setIsShaderReady} />
          </div>
        </ShaderErrorBoundary>
      ) : null}
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
