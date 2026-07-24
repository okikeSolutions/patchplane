import { describe, expect, test } from 'vitest'
import { decisionRecord } from './review-decision'

const candidates = [
  { id: 'candidate-reviewed', createdAt: 10, headSha: 'reviewed-sha' },
  { id: 'candidate-after-decision', createdAt: 20, headSha: 'later-sha' },
]

describe('decision publication record correlation', () => {
  test('uses the candidate pinned to the durable human decision', () => {
    expect(
      decisionRecord(
        candidates,
        {
          id: 'decision-1',
          decidedAt: 15,
          candidatePatchSetId: 'candidate-reviewed',
        },
        'candidatePatchSetId',
        (candidate) => candidate.createdAt,
      ),
    ).toMatchObject({ id: 'candidate-reviewed', headSha: 'reviewed-sha' })
  })

  test('never silently falls through when a pinned candidate is absent', () => {
    expect(() =>
      decisionRecord(
        candidates,
        {
          id: 'decision-1',
          candidatePatchSetId: 'candidate-missing',
        },
        'candidatePatchSetId',
        (candidate) => candidate.createdAt,
      ),
    ).toThrow('candidatePatchSetId is missing from workflow detail')
  })

  test('keeps legacy decisions pinned to records created before the decision', () => {
    expect(
      decisionRecord(
        candidates,
        { id: 'legacy-decision', decidedAt: 15 },
        'candidatePatchSetId',
        (candidate) => candidate.createdAt,
      ),
    ).toMatchObject({ id: 'candidate-reviewed', headSha: 'reviewed-sha' })
  })
})
