import { Effect } from 'effect'
import type { CandidatePatchSet } from '@patchplane/domain/decision-review'
import type { TelemetryContextFields } from '../services/telemetry-service'
import {
  criticalPathBreadcrumbStatuses,
  criticalPathStages,
  withCriticalPathTransition,
  withCriticalPathTransitionOutcome,
} from '../services/telemetry-service'

interface SandboxWorkflowTransitionContext extends TelemetryContextFields {
  readonly operation: string
}

export function withAttemptClaimTransition<E, R>(
  input: SandboxWorkflowTransitionContext,
  effect: Effect.Effect<boolean, E, R>,
) {
  return withCriticalPathTransitionOutcome(
    { ...input, stage: criticalPathStages.attemptClaim },
    effect,
    (claimed) =>
      claimed
        ? criticalPathBreadcrumbStatuses.succeeded
        : criticalPathBreadcrumbStatuses.blocked,
  )
}

export function withRequirementsPersistedTransition<A, E, R>(
  input: SandboxWorkflowTransitionContext,
  effect: Effect.Effect<A, E, R>,
) {
  return withCriticalPathTransition(
    { ...input, stage: criticalPathStages.requirementsPersisted },
    effect,
  )
}

export function withSandboxExecutionTransition<A, E, R>(
  input: SandboxWorkflowTransitionContext,
  effect: Effect.Effect<A, E, R>,
) {
  return withCriticalPathTransition(
    { ...input, stage: criticalPathStages.sandboxExecution },
    effect,
  )
}

export function withCandidateFreezeTransition<E, R>(
  input: SandboxWorkflowTransitionContext,
  effect: Effect.Effect<CandidatePatchSet, E, R>,
) {
  return withCriticalPathTransitionOutcome(
    { ...input, stage: criticalPathStages.candidateFrozen },
    effect,
    (candidate) => candidateBreadcrumbStatus(candidate.status),
  )
}

export function withVerificationTransition<A, E, R>(
  input: SandboxWorkflowTransitionContext,
  effect: Effect.Effect<A, E, R>,
) {
  return withCriticalPathTransition(
    { ...input, stage: criticalPathStages.verification },
    effect,
  )
}

export function candidateBreadcrumbStatus(status: CandidatePatchSet['status']) {
  switch (status) {
    case 'captured':
      return criticalPathBreadcrumbStatuses.succeeded
    case 'empty':
      return criticalPathBreadcrumbStatuses.blocked
    case 'failed':
      return criticalPathBreadcrumbStatuses.failed
    default:
      return status satisfies never
  }
}
