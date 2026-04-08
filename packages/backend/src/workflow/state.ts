export function buildRuntimeSessionCompletionPatch(completedAt: number) {
  return {
    status: 'completed' as const,
    endedAt: completedAt,
    updatedAt: completedAt,
  }
}

export function buildReviewedWorkflowRunPatch(reviewedAt: number) {
  return {
    status: 'reviewed' as const,
    completedAt: reviewedAt,
    updatedAt: reviewedAt,
  }
}

export function buildReviewedPromptRequestPatch(reviewedAt: number) {
  return {
    status: 'reviewed' as const,
    updatedAt: reviewedAt,
  }
}
