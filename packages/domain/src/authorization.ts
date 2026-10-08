import { Match } from 'effect'
import type { WorkspaceRole } from './membership'
import { patchPlanePermissions, type Permission } from './permission'

export const rolePermissions = {
  owner: [
    'workspace:view',
    'repo:connect',
    'prompt:create',
    'run:start',
    'run:interrupt',
    'review:create',
    'decision:approve',
    'decision:reject',
    'publication:create',
  ],
  admin: [
    'workspace:view',
    'repo:connect',
    'prompt:create',
    'run:start',
    'run:interrupt',
    'review:create',
    'decision:approve',
    'decision:reject',
    'publication:create',
  ],
  maintainer: [
    'workspace:view',
    'repo:connect',
    'prompt:create',
    'run:start',
    'run:interrupt',
    'review:create',
    'decision:approve',
    'decision:reject',
    'publication:create',
  ],
  reviewer: ['workspace:view', 'review:create'],
  operator: [
    'workspace:view',
    'prompt:create',
    'run:start',
    'run:interrupt',
    'decision:approve',
    'decision:reject',
  ],
  viewer: ['workspace:view'],
} satisfies Record<WorkspaceRole, ReadonlyArray<Permission>>

const permissionSet = new Set<string>(patchPlanePermissions)

export function normalizeWorkspaceRole(
  role: string | undefined,
): WorkspaceRole {
  return Match.value(role).pipe(
    Match.when('owner', () => 'owner' as const),
    Match.when('admin', () => 'admin' as const),
    Match.when('maintainer', () => 'maintainer' as const),
    Match.when('reviewer', () => 'reviewer' as const),
    Match.when('operator', () => 'operator' as const),
    Match.when('viewer', () => 'viewer' as const),
    Match.when('member', () => 'operator' as const),
    Match.orElse(() => 'viewer' as const),
  )
}

export function isPatchPlanePermission(value: string): value is Permission {
  return permissionSet.has(value)
}

export function mapExternalPermissions(
  permissions: ReadonlyArray<string> = [],
): ReadonlyArray<Permission> {
  return permissions.filter(isPatchPlanePermission)
}

export function mapWorkspaceRolesToPermissions(
  role: string,
  roles: ReadonlyArray<string> = [],
): ReadonlyArray<Permission> {
  const workspaceRoles = new Set([
    normalizeWorkspaceRole(role),
    ...roles.map(normalizeWorkspaceRole),
  ])
  const permissions = new Set<Permission>()

  for (const workspaceRole of workspaceRoles) {
    for (const permission of rolePermissions[workspaceRole]) {
      permissions.add(permission)
    }
  }

  return [...permissions]
}
