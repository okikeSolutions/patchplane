import { Schema } from 'effect'

export const CriticalPathStage = Schema.Literals([
  'request-authorization',
  'source-pinning',
  'attempt-claim',
  'requirements-persisted',
  'sandbox-execution',
  'candidate-frozen',
  'verification',
  'review-policy',
  'report-assembled',
  'human-decision',
  'rerun-created',
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
