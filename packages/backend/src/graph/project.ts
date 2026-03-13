import type { PromptRequest, ReviewRun, RuntimeEvent } from '@patchplane/domain'
import type { ReviewEvaluation } from '../policy/evaluate'

export interface LineageProjection {
  request: PromptRequest
  events: ReadonlyArray<RuntimeEvent>
  reviews: ReadonlyArray<ReviewRun>
  reviewEvaluation: ReviewEvaluation
}

export function projectLineage(
  request: PromptRequest,
  events: ReadonlyArray<RuntimeEvent>,
  reviews: ReadonlyArray<ReviewRun>,
  reviewEvaluation: ReviewEvaluation,
): LineageProjection {
  return {
    request,
    events,
    reviews,
    reviewEvaluation,
  }
}
