import { Effect } from 'effect'
import type { ListRecentWorkflowStartsInput } from '@patchplane/domain/list-recent-workflow-starts'
import { StorageService } from '../services/storage-service'

export const ListRecentWorkflowStarts = Effect.fn(
  '@patchplane/core/workflows/ListRecentWorkflowStarts',
)(function*(input: ListRecentWorkflowStartsInput) {
  yield* Effect.annotateCurrentSpan({
    workspaceId: input.workspaceId,
    limit: input.limit,
  })

  yield* Effect.logInfo('Listing recent workflow starts')

  const storage = yield* StorageService
  const workflowStarts = yield* storage.listRecentWorkflowStarts(input)

  yield* Effect.logInfo('Listed recent workflow starts', {
    count: workflowStarts.length,
  })

  return workflowStarts
})
