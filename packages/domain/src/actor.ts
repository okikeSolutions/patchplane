import { Schema } from 'effect'
import { ActorId } from './ids'

export const Actor = Schema.Struct({
  id: ActorId,
  displayName: Schema.String,
})
export type Actor = Schema.Schema.Type<typeof Actor>
