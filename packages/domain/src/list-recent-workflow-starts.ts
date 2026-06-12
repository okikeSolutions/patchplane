import { Schema } from 'effect'
import { WorkspaceId } from './ids'

export const ListRecentWorkflowStartsInput = Schema.Struct({
  workspaceId: WorkspaceId,
  limit: Schema.optional(Schema.Number),
})
export type ListRecentWorkflowStartsInput = Schema.Schema.Type<
  typeof ListRecentWorkflowStartsInput
>
