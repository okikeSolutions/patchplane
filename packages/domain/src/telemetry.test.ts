import { assert, describe, it } from '@effect/vitest'
import { Schema } from 'effect'
import {
  CriticalPathBreadcrumbStatus,
  CriticalPathStage,
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
  })
})
