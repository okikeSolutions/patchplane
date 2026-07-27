import { Component, type ReactNode } from 'react'
import { CircleAlertIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import * as m from '@/paraglide/messages'

export type CandidateDiffRendererFailure = 'malformed' | 'processor-unavailable'

export class CandidateDiffProcessorUnavailableError extends Error {
  readonly _tag = 'CandidateDiffProcessorUnavailableError'
}

export class CandidateDiffFailureBoundary extends Component<
  {
    readonly children: ReactNode
    readonly fallbackKind: CandidateDiffRendererFailure
    readonly onFailure?: (failure: CandidateDiffRendererFailure) => void
  },
  { readonly error?: unknown }
> {
  override state: { readonly error?: unknown } = {}

  static getDerivedStateFromError(error: unknown) {
    return { error }
  }

  override componentDidCatch(error: unknown) {
    this.props.onFailure?.(
      candidateDiffRendererFailure(error, this.props.fallbackKind),
    )
  }

  override render() {
    if (this.state.error === undefined) return this.props.children
    const failure = candidateDiffRendererFailure(
      this.state.error,
      this.props.fallbackKind,
    )
    const copy =
      failure === 'malformed'
        ? {
            title: m.app_changes_problem_malformed_title(),
            reason: m.app_changes_problem_malformed_reason(),
            consequence: m.app_changes_problem_malformed_consequence(),
          }
        : {
            title: m.app_changes_problem_processor_unavailable_title(),
            reason: m.app_changes_problem_processor_unavailable_reason(),
            consequence:
              m.app_changes_problem_processor_unavailable_consequence(),
          }
    return (
      <Alert
        role="alert"
        variant={
          failure === 'processor-unavailable' ? 'warning' : 'destructive'
        }
      >
        <CircleAlertIcon />
        <AlertTitle>{copy.title}</AlertTitle>
        <AlertDescription className="flex flex-col gap-2">
          <p className="m-0">{copy.reason}</p>
          <p className="m-0">
            <strong>{m.app_changes_decision()}:</strong> {copy.consequence}
          </p>
        </AlertDescription>
      </Alert>
    )
  }
}

export function candidateDiffRendererFailure(
  error: unknown,
  fallbackKind: CandidateDiffRendererFailure,
): CandidateDiffRendererFailure {
  return error instanceof CandidateDiffProcessorUnavailableError
    ? 'processor-unavailable'
    : fallbackKind
}
