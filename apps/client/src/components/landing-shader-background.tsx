import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import ShaderScene from './landing-shader-scene'

const minimumLoaderDurationMs = 700
const loaderExitDurationMs = 420
const shaderFallbackTimeoutMs = 2500

export function LandingShaderBackground() {
  const startedAt = useRef(Date.now())
  const revealScheduled = useRef(false)
  const [isMounted, setIsMounted] = useState(false)
  const [isRevealing, setIsRevealing] = useState(false)
  const [isLoaderVisible, setIsLoaderVisible] = useState(true)

  const revealShader = useCallback(() => {
    if (revealScheduled.current) return
    revealScheduled.current = true

    const elapsed = Date.now() - startedAt.current
    const remaining = Math.max(0, minimumLoaderDurationMs - elapsed)

    window.setTimeout(() => setIsRevealing(true), remaining)
  }, [])

  useEffect(() => {
    setIsMounted(true)

    const fallbackTimeout = window.setTimeout(
      revealShader,
      shaderFallbackTimeoutMs,
    )

    return () => window.clearTimeout(fallbackTimeout)
  }, [revealShader])

  useEffect(() => {
    if (!isRevealing) return undefined

    const removalTimeout = window.setTimeout(
      () => setIsLoaderVisible(false),
      loaderExitDurationMs,
    )

    return () => {
      window.clearTimeout(removalTimeout)
    }
  }, [isRevealing])

  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[radial-gradient(ellipse_at_3%_10%,rgb(248_174_65/0.62),transparent_48%),radial-gradient(ellipse_at_86%_20%,rgb(38_55_83/0.36),transparent_52%),radial-gradient(ellipse_at_52%_42%,rgb(245_242_240/0.34),transparent_66%),linear-gradient(125deg,rgb(217_199_170/0.38),var(--background)_74%)] dark:bg-[radial-gradient(ellipse_at_86%_20%,rgb(72_84_110/0.18),transparent_54%),linear-gradient(125deg,rgb(28_24_29/0.32),var(--background)_74%)]"
      >
        <ShaderErrorBoundary onError={revealShader}>
          <div className="absolute inset-0 opacity-80 motion-reduce:hidden dark:opacity-75 dark:brightness-50 dark:contrast-[1.08] dark:saturate-[1.15]">
            <ShaderScene onFirstFrame={revealShader} />
          </div>
        </ShaderErrorBoundary>
        <div className="absolute inset-0 bg-[rgb(245_242_240/0.18)] dark:bg-[rgb(10_14_24/0.32)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_38%,rgb(245_242_240/0.12)_0%,rgb(245_242_240/0.04)_38%,transparent_68%)] dark:bg-[radial-gradient(ellipse_at_50%_38%,transparent_0%,rgb(10_14_24/0.08)_55%,rgb(10_14_24/0.2)_100%)]" />
      </div>

      {isLoaderVisible ? (
        isMounted ? (
          createPortal(
            <ShaderLoader isRevealing={isRevealing} />,
            document.body,
          )
        ) : (
          <ShaderLoader isRevealing={isRevealing} />
        )
      ) : null}
    </>
  )
}

function ShaderLoader({ isRevealing }: { readonly isRevealing: boolean }) {
  return (
    <div
      data-testid="shader-loader"
      data-state={isRevealing ? 'revealing' : 'loading'}
      className="shader-loader"
      aria-live="polite"
      aria-label="Loading Patchplane"
    >
      <div className="shader-loader__lockup">
        <img
          src="/brand/patchplane-wordmark-dark.svg"
          alt="patchplane"
          className="shader-loader__wordmark"
        />
        <div className="shader-loader__evidence" aria-hidden="true">
          <span>Evidence before trust</span>
          <span className="shader-loader__track">
            <span className="shader-loader__signal" />
          </span>
        </div>
      </div>
    </div>
  )
}

interface ShaderErrorBoundaryProps {
  readonly children: ReactNode
  readonly onError?: () => void
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
    this.props.onError?.()
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}
