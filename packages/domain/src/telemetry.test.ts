import { assert, describe, it } from '@effect/vitest'
import { Schema } from 'effect'
import {
  CriticalPathBreadcrumbStatus,
  CriticalPathStage,
  criticalPathBreadcrumbStatuses,
  criticalPathStages,
  makeCriticalPathBreadcrumbStatus,
  makeCriticalPathStage,
} from './telemetry'

describe('telemetry domain values', () => {
  it('constructs only bounded critical-path stages and statuses', () => {
    assert.strictEqual(
      makeCriticalPathStage('candidate-frozen'),
      'candidate-frozen',
    )
    assert.strictEqual(makeCriticalPathBreadcrumbStatus('failed'), 'failed')
    assert.throws(() =>
      Schema.decodeUnknownSync(CriticalPathStage)('custom-stage'),
    )
    assert.throws(() =>
      Schema.decodeUnknownSync(CriticalPathBreadcrumbStatus)('pending'),
    )
    assert.deepStrictEqual(criticalPathStages, {
      intakeAccepted: 'intake-accepted',
      attemptCreated: 'attempt-created',
      attemptClaim: 'attempt-claim',
      requirementsPersisted: 'requirements-persisted',
      sandboxExecution: 'sandbox-execution',
      candidateFrozen: 'candidate-frozen',
      verification: 'verification',
      review: 'review',
      policy: 'policy',
      humanDecision: 'human-decision',
      rerunCreated: 'rerun-created',
      publicationClaim: 'publication-claim',
      publicationResult: 'publication-result',
    })
    assert.deepStrictEqual(criticalPathBreadcrumbStatuses, {
      started: 'started',
      succeeded: 'succeeded',
      failed: 'failed',
      blocked: 'blocked',
    })
  })
})
