import { Effect } from 'effect'
import type { PolicyBundle, ReviewRun } from '@patchplane/domain'
import { ReviewFailure } from '../errors'

export interface ReviewEvaluation {
  readonly averageScore: number
  readonly reviewCount: number
}

export type ReviewEvaluationInput = Pick<
  ReviewRun,
  'reviewer' | 'score' | 'passed' | 'summary'
>

export function evaluateReviews(
  requestId: string,
  reviewRuns: ReadonlyArray<ReviewEvaluationInput>,
  policy: Pick<PolicyBundle, 'requiredReviewers' | 'minimumScore'>,
) {
  const requiredReviewers = [...new Set(policy.requiredReviewers)]
  const coveredReviewers = new Set(reviewRuns.map((review) => review.reviewer))
  const missingReviewers = requiredReviewers.filter(
    (reviewer) => !coveredReviewers.has(reviewer),
  )
  const averageScore =
    reviewRuns.length === 0
      ? 0
      : reviewRuns.reduce((sum, review) => sum + review.score, 0) /
        reviewRuns.length

  const reasons = [
    ...(missingReviewers.length > 0
      ? [`Missing required reviewers: ${missingReviewers.join(', ')}.`]
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
