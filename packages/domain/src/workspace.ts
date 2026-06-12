import { Schema } from 'effect'
import { WorkspaceId } from './ids'

export const Workspace = Schema.Struct({
  id: WorkspaceId,
  name: Schema.String,
})
export type Workspace = Schema.Schema.Type<typeof Workspace>
