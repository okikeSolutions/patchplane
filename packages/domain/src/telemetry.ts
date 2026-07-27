import { Schema } from 'effect'

export const CriticalPathStage = Schema.Literals([
  'request-authorization',
  'intake-accepted',
  'source-pinning',
  'attempt-created',
  'attempt-claim',
  'requirements-persisted',
  'sandbox-execution',
  'candidate-frozen',
  'verification',
  'review',
  'policy',
  'review-policy',
  'report-assembled',
  'human-decision',
  'rerun-created',
  'publication-claim',
  'publication-result',
  'publication',
  'release-readback',
]).pipe(Schema.brand('CriticalPathStage'))
export type CriticalPathStage = Schema.Schema.Type<typeof CriticalPathStage>

export const CriticalPathBreadcrumbStatus = Schema.Literals([
  'started',
  'succeeded',
  'failed',
  'blocked',
]).pipe(Schema.brand('CriticalPathBreadcrumbStatus'))
export type CriticalPathBreadcrumbStatus = Schema.Schema.Type<
  typeof CriticalPathBreadcrumbStatus
>

export const makeCriticalPathStage = Schema.decodeUnknownSync(CriticalPathStage)
export const makeCriticalPathBreadcrumbStatus = Schema.decodeUnknownSync(
  CriticalPathBreadcrumbStatus,
)

export const criticalPathStages = {
  intakeAccepted: makeCriticalPathStage('intake-accepted'),
  attemptCreated: makeCriticalPathStage('attempt-created'),
  attemptClaim: makeCriticalPathStage('attempt-claim'),
  requirementsPersisted: makeCriticalPathStage('requirements-persisted'),
  sandboxExecution: makeCriticalPathStage('sandbox-execution'),
  candidateFrozen: makeCriticalPathStage('candidate-frozen'),
  verification: makeCriticalPathStage('verification'),
  review: makeCriticalPathStage('review'),
  policy: makeCriticalPathStage('policy'),
  humanDecision: makeCriticalPathStage('human-decision'),
  rerunCreated: makeCriticalPathStage('rerun-created'),
  publicationClaim: makeCriticalPathStage('publication-claim'),
  publicationResult: makeCriticalPathStage('publication-result'),
} as const

export const criticalPathBreadcrumbStatuses = {
  started: makeCriticalPathBreadcrumbStatus('started'),
  succeeded: makeCriticalPathBreadcrumbStatus('succeeded'),
  failed: makeCriticalPathBreadcrumbStatus('failed'),
  blocked: makeCriticalPathBreadcrumbStatus('blocked'),
} as const
