import { Effect } from 'effect'
import type { ReviewRun } from '@patchplane/domain'
import type { BackendConfigShape } from '../config/schema'
import { ReviewFailure } from '../errors'

export interface ReviewEvaluation {
  readonly averageScore: number
  readonly reviewCount: number
}

export function evaluateReviews(
  requestId: string,
  reviewRuns: ReadonlyArray<ReviewRun>,
  policy: BackendConfigShape['policy'],
) {
  const averageScore =
    reviewRuns.length === 0
      ? 0
      : reviewRuns.reduce((sum, review) => sum + review.score, 0) /
        reviewRuns.length

  const reasons = [
    ...(reviewRuns.length < policy.requiredReviewers.length
      ? ['Missing required review coverage.']
      : []),
    ...(averageScore < policy.minimumScore
      ? ['Average review score is below policy minimum.']
      : []),
    ...(reviewRuns.some((review) => !review.passed)
      ? ['At least one review run failed.']
      : []),
  ]

  return reasons.length > 0
    ? Effect.fail(
        new ReviewFailure({
          requestId,
          minimumScore: policy.minimumScore,
          actualScore: averageScore,
          reasons,
        }),
      )
    : Effect.succeed<ReviewEvaluation>({
        averageScore,
        reviewCount: reviewRuns.length,
      })
}
