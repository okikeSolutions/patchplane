import { describe, expect, it } from '@effect/vitest'
import type {
  Organization,
  OrganizationMembership,
  User,
} from '@workos-inc/node'
import {
  mapWorkOSMembershipToMembership,
  mapWorkOSOrganizationToWorkspace,
  mapWorkOSPermissions,
  mapWorkOSRolesToPermissions,
  mapWorkOSUserToActor,
} from './mapping'

const workOSUser = {
  object: 'user',
  id: 'user_123',
  email: 'ada@example.com',
  emailVerified: true,
  profilePictureUrl: null,
  name: 'Ada Lovelace',
  firstName: 'Ada',
  lastName: 'Lovelace',
  lastSignInAt: null,
  locale: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  externalId: null,
  metadata: {},
} satisfies User

const workOSOrganization = {
  object: 'organization',
  id: 'org_123',
  name: 'Ada Labs',
  allowProfilesOutsideOrganization: false,
  domains: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  externalId: null,
  metadata: {},
} satisfies Organization

const workOSMembership = {
  object: 'organization_membership',
  id: 'om_123',
  organizationId: 'org_123',
  organizationName: 'Ada Labs',
  status: 'active',
  userId: 'user_123',
  directoryManaged: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  customAttributes: {},
  role: { slug: 'admin' },
  roles: [{ slug: 'reviewer' }],
} satisfies OrganizationMembership

describe('WorkOS mapping', () => {
  it('maps WorkOS users to namespaced PatchPlane actors', () => {
    const actor = mapWorkOSUserToActor(workOSUser)

    expect(actor.id).toBe('workos:user_123')
    expect(actor.displayName).toBe('Ada Lovelace')
  })

  it('falls back to email for actor display name', () => {
    const actor = mapWorkOSUserToActor({
      ...workOSUser,
      name: null,
    })

    expect(actor.id).toBe('workos:user_123')
    expect(actor.displayName).toBe('ada@example.com')
  })

  it('maps WorkOS organizations to namespaced PatchPlane workspaces', () => {
    const workspace = mapWorkOSOrganizationToWorkspace(workOSOrganization)

    expect(workspace.id).toBe('workos:org_123')
    expect(workspace.name).toBe('Ada Labs')
  })

  it('maps WorkOS organization memberships to PatchPlane memberships', () => {
    const membership = mapWorkOSMembershipToMembership(workOSMembership)

    expect(membership.id).toBe('om_123')
    expect(membership.actorId).toBe('workos:user_123')
    expect(membership.workspaceId).toBe('workos:org_123')
    expect(membership.role).toBe('admin')
    expect(membership.roles).toEqual(['admin', 'reviewer'])
    expect(membership.permissions).toContain('workspace:view')
    expect(membership.permissions).toContain('decision:approve')
  })

  it('maps WorkOS member role to operator permissions for MVP workflow starts', () => {
    expect(mapWorkOSRolesToPermissions('member')).toContain('prompt:create')
  })

  it('filters WorkOS permission claims through the domain Permission schema', () => {
    expect(mapWorkOSPermissions(['prompt:create', 'workos:unknown'])).toEqual([
      'prompt:create',
    ])
  })

  it('maps unknown WorkOS roles to viewer permissions', () => {
    expect(mapWorkOSRolesToPermissions('custom-role')).toEqual([
      'workspace:view',
    ])
  })
})
