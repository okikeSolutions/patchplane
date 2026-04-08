import { describe, expect, test } from 'bun:test'
import {
  buildReviewedPromptRequestPatch,
  buildReviewedWorkflowRunPatch,
  buildRuntimeSessionCompletionPatch,
} from '../src/workflow/state'

describe('workflow state helpers', () => {
  test('marks successful reviewed workflow runs as reviewed while preserving completion time', () => {
    const reviewedAt = 1_710_000_000_000

    expect(buildReviewedWorkflowRunPatch(reviewedAt)).toEqual({
      status: 'reviewed',
      completedAt: reviewedAt,
      updatedAt: reviewedAt,
    })
    expect(buildReviewedPromptRequestPatch(reviewedAt)).toEqual({
      status: 'reviewed',
      updatedAt: reviewedAt,
    })
  })

  test('completes runtime sessions without promoting the workflow itself to completed', () => {
    const completedAt = 1_710_000_000_500

    expect(buildRuntimeSessionCompletionPatch(completedAt)).toEqual({
      status: 'completed',
      endedAt: completedAt,
      updatedAt: completedAt,
    })
  })
})
