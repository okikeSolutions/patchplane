import { Schema } from 'effect'
import {
  mapExternalPermissions,
  mapWorkspaceRolesToPermissions,
  normalizeWorkspaceRole,
} from '@patchplane/domain/authorization'
import {
  makeWorkOSActorId,
  makeWorkOSWorkspaceId,
} from '@patchplane/domain/ids'
import type { Membership } from '@patchplane/domain/membership'
import type { Permission } from '@patchplane/domain/permission'
import type { Workspace } from '@patchplane/domain/workspace'

export const WorkOSOrganizationResponse = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
})
export type WorkOSOrganizationResponse = Schema.Schema.Type<
  typeof WorkOSOrganizationResponse
>
export const decodeWorkOSOrganizationResponse = Schema.decodeUnknownEffect(
  WorkOSOrganizationResponse,
)

const WorkOSRoleResponse = Schema.Struct({ slug: Schema.NonEmptyString })
export const WorkOSMembershipResponse = Schema.Struct({
  id: Schema.NonEmptyString,
  organizationId: Schema.NonEmptyString,
  status: Schema.Literals(['active', 'inactive', 'pending']),
  userId: Schema.NonEmptyString,
  role: WorkOSRoleResponse,
  roles: Schema.optional(Schema.Array(WorkOSRoleResponse)),
})
export type WorkOSMembershipResponse = Schema.Schema.Type<
  typeof WorkOSMembershipResponse
>
export const decodeWorkOSMembershipResponse = Schema.decodeUnknownEffect(
  WorkOSMembershipResponse,
)

export { normalizeWorkspaceRole }

export function mapWorkOSPermissions(
  permissions: ReadonlyArray<string> = [],
): ReadonlyArray<Permission> {
  return mapExternalPermissions(permissions)
}

export function mapWorkOSOrganizationToWorkspace(
  organization: WorkOSOrganizationResponse,
): Workspace {
  return {
    id: makeWorkOSWorkspaceId(organization.id),
    name: organization.name,
  }
}

export function mapWorkOSRolesToPermissions(
  role: string,
  roles: ReadonlyArray<string> = [],
): ReadonlyArray<Permission> {
  return mapWorkspaceRolesToPermissions(role, roles)
}

export function mapWorkOSMembershipToMembership(
  membership: WorkOSMembershipResponse,
): Membership {
  const role = normalizeWorkspaceRole(membership.role.slug)
  const roles = [
    ...new Set([
      role,
      ...(membership.roles?.map((item) => normalizeWorkspaceRole(item.slug)) ??
        []),
    ]),
  ]

  return {
    id: membership.id,
    actorId: makeWorkOSActorId(membership.userId),
    workspaceId: makeWorkOSWorkspaceId(membership.organizationId),
    status: membership.status,
    role,
    roles,
    permissions: [...mapWorkOSRolesToPermissions(role, roles)],
  }
}
