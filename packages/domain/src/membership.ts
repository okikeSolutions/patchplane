import { Schema } from 'effect'
import { ActorId, WorkspaceId } from './ids'
import { Permission } from './permission'

export const WorkspaceRole = Schema.Literals([
  'owner',
  'admin',
  'maintainer',
  'reviewer',
  'operator',
  'viewer',
])
export type WorkspaceRole = Schema.Schema.Type<typeof WorkspaceRole>

export const MembershipStatus = Schema.Literals(['active', 'inactive', 'pending'])
export type MembershipStatus = Schema.Schema.Type<typeof MembershipStatus>

export const Membership = Schema.Struct({
  id: Schema.String,
  actorId: ActorId,
  workspaceId: WorkspaceId,
  status: MembershipStatus,
  role: WorkspaceRole,
  roles: Schema.Array(WorkspaceRole),
  permissions: Schema.Array(Permission),
})
export type Membership = Schema.Schema.Type<typeof Membership>

export const decodeMembership = Schema.decodeUnknownEffect(Membership)
