import type {
  Organization,
  OrganizationMembership,
  User,
} from '@workos-inc/node'
import type { Actor } from '@patchplane/domain/actor'
import {
  isPatchPlanePermission,
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

export { isPatchPlanePermission, normalizeWorkspaceRole }

export function mapWorkOSPermissions(
  permissions: ReadonlyArray<string> = [],
): ReadonlyArray<Permission> {
  return mapExternalPermissions(permissions)
}

export function mapWorkOSUserToActor(user: User): Actor {
  return {
    id: makeWorkOSActorId(user.id),
    displayName: user.name ?? user.email,
  }
}

export function mapWorkOSOrganizationToWorkspace(
  organization: Organization,
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
  membership: OrganizationMembership,
): Membership {
  const role = normalizeWorkspaceRole(membership.role.slug)
  const roles = [
    ...new Set([
      role,
      ...(membership.roles?.map((item) => normalizeWorkspaceRole(item.slug)) ?? []),
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
