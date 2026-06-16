import type { Actor } from '@patchplane/domain/actor'
import {
  makeWorkOSActorId,
  makeWorkOSWorkspaceId,
} from '@patchplane/domain/ids'
import type { Membership } from '@patchplane/domain/membership'
import type { Permission } from '@patchplane/domain/permission'
import type { Workspace } from '@patchplane/domain/workspace'
import type { AuthRequest } from '@patchplane/core/services/auth-request-context'
import {
  mapWorkOSPermissions,
  mapWorkOSRolesToPermissions,
  normalizeWorkspaceRole,
} from './mapping'

export interface WorkOSSessionUser {
  readonly id: string
  readonly email: string
  readonly name?: string | null
}

export interface WorkOSAuthSession {
  readonly user: WorkOSSessionUser | null
  readonly sessionId?: string
  readonly organizationId?: string
  readonly role?: string
  readonly roles?: ReadonlyArray<string>
  readonly permissions?: ReadonlyArray<string>
  readonly accessToken?: string
}

function permissionsFromSession(session: WorkOSAuthSession) {
  if (!session.user || !session.organizationId) {
    return []
  }

  const role = normalizeWorkspaceRole(session.role)
  const roles = session.roles?.map(normalizeWorkspaceRole) ?? []
  const rolePermissions = mapWorkOSRolesToPermissions(role, roles)
  const explicitPermissions = mapWorkOSPermissions(session.permissions)
  return [...new Set([...rolePermissions, ...explicitPermissions])]
}

function mapWorkOSSessionUserToActor(user: WorkOSSessionUser): Actor {
  return {
    id: makeWorkOSActorId(user.id),
    displayName: user.name ?? user.email,
  }
}

export function mapWorkOSSessionToAuthRequest(
  session: WorkOSAuthSession,
): AuthRequest {
  const actor: Actor | null = session.user
    ? mapWorkOSSessionUserToActor(session.user)
    : null
  const workspace: Workspace | null = session.organizationId
    ? {
        id: makeWorkOSWorkspaceId(session.organizationId),
        name: session.organizationId,
      }
    : null
  const explicitPermissions: ReadonlyArray<Permission> =
    session.user && session.organizationId
      ? mapWorkOSPermissions(session.permissions)
      : []
  const permissions = permissionsFromSession(session)
  const role = normalizeWorkspaceRole(session.role)
  const roles = [role, ...(session.roles?.map(normalizeWorkspaceRole) ?? [])]
  const memberships: ReadonlyArray<Membership> =
    actor && workspace && session.organizationId && session.user
      ? [
          {
            id: `${session.organizationId}:${session.user.id}`,
            actorId: actor.id,
            workspaceId: workspace.id,
            status: 'active',
            role,
            roles,
            permissions,
          },
        ]
      : []

  return {
    actor,
    workspace,
    memberships,
    permissions,
    explicitPermissions,
    ...(session.accessToken === undefined
      ? {}
      : { accessToken: session.accessToken }),
  }
}
