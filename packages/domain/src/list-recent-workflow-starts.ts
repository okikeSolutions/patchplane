import { Schema } from 'effect'
import { WorkspaceId } from './ids'
import { PositiveInt } from './refinements'

export const ListRecentWorkflowStartsInput = Schema.Struct({
  workspaceId: WorkspaceId,
  limit: Schema.optional(PositiveInt),
})
export type ListRecentWorkflowStartsInput = Schema.Schema.Type<
  typeof ListRecentWorkflowStartsInput
>
