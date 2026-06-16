import { AuthKit, type AuthFunctions } from '@convex-dev/workos-authkit'
import {
  mapWorkspaceRolesToPermissions,
  normalizeWorkspaceRole,
} from '@patchplane/domain/authorization'
import { components, internal } from './_generated/api'
import type { DataModel } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'

const authFunctions: AuthFunctions = internal.auth

export const authKit = new AuthKit<DataModel>(components.workOSAuthKit, {
  authFunctions,
  additionalEventTypes: [
    'organization_membership.created',
    'organization_membership.updated',
    'organization_membership.deleted',
  ],
})

interface WorkOSUserData {
  id: string
  firstName?: string | null
  lastName?: string | null
  name?: string | null
  email: string
}

interface WorkOSMembershipRole {
  slug: string
}

interface WorkOSMembershipData {
  id: string
  organizationId: string
  userId: string
  status: 'active' | 'inactive' | 'pending'
  role: WorkOSMembershipRole
  roles?: ReadonlyArray<WorkOSMembershipRole>
}

function displayName(user: {
  firstName?: string | null
  lastName?: string | null
  name?: string | null
  email: string
}) {
  const name =
    user.name ?? [user.firstName, user.lastName].filter(Boolean).join(' ')
  return name || user.email
}

function activeUserPatch(user: WorkOSUserData) {
  return {
    authId: user.id,
    email: user.email,
    name: displayName(user),
    firstName: user.firstName ?? undefined,
    lastName: user.lastName ?? undefined,
    status: 'active' as const,
    updatedAt: Date.now(),
  }
}

function membershipPatch(data: WorkOSMembershipData) {
  const role = normalizeWorkspaceRole(data.role.slug)
  const roles = [
    ...new Set([
      role,
      ...(data.roles?.map((item) => normalizeWorkspaceRole(item.slug)) ?? []),
    ]),
  ]

  return {
    workosMembershipId: data.id,
    authId: data.userId,
    organizationId: data.organizationId,
    status: data.status,
    role,
    roles,
    permissions: [...mapWorkspaceRolesToPermissions(role, roles)],
    updatedAt: Date.now(),
  }
}

export async function syncWorkOSUserCreated(
  ctx: MutationCtx,
  data: WorkOSUserData,
) {
  const user = await ctx.db
    .query('users')
    .withIndex('by_auth_id', (q) => q.eq('authId', data.id))
    .unique()
  const patch = activeUserPatch(data)

  if (user === null) {
    await ctx.db.insert('users', patch)
    return
  }

  await ctx.db.replace('users', user['_id'], patch)
}

export async function syncWorkOSUserUpdated(
  ctx: MutationCtx,
  data: WorkOSUserData,
) {
  const user = await ctx.db
    .query('users')
    .withIndex('by_auth_id', (q) => q.eq('authId', data.id))
    .unique()
  const patch = activeUserPatch(data)

  if (user === null) {
    await ctx.db.insert('users', patch)
    return
  }

  await ctx.db.replace('users', user['_id'], patch)
}

export async function syncWorkOSUserDeleted(
  ctx: MutationCtx,
  data: { id: string },
) {
  const user = await ctx.db
    .query('users')
    .withIndex('by_auth_id', (q) => q.eq('authId', data.id))
    .unique()

  if (user === null) {
    return
  }

  await ctx.db.patch('users', user['_id'], {
    deletedAt: Date.now(),
    status: 'deleted',
    updatedAt: Date.now(),
  })
}

export async function syncWorkOSMembershipCreated(
  ctx: MutationCtx,
  data: WorkOSMembershipData,
) {
  const membership = await ctx.db
    .query('memberships')
    .withIndex('by_workos_membership_id', (q) =>
      q.eq('workosMembershipId', data.id),
    )
    .unique()
  const patch = membershipPatch(data)

  if (membership === null) {
    await ctx.db.insert('memberships', patch)
    return
  }

  await ctx.db.replace('memberships', membership['_id'], patch)
}

export async function syncWorkOSMembershipUpdated(
  ctx: MutationCtx,
  data: WorkOSMembershipData,
) {
  await syncWorkOSMembershipCreated(ctx, data)
}

export async function syncWorkOSMembershipDeleted(
  ctx: MutationCtx,
  data: WorkOSMembershipData,
) {
  const membership = await ctx.db
    .query('memberships')
    .withIndex('by_workos_membership_id', (q) =>
      q.eq('workosMembershipId', data.id),
    )
    .unique()

  if (membership === null) {
    await ctx.db.insert('memberships', {
      ...membershipPatch(data),
      status: 'deleted',
      deletedAt: Date.now(),
    })
    return
  }

  await ctx.db.patch('memberships', membership['_id'], {
    status: 'deleted',
    deletedAt: Date.now(),
    updatedAt: Date.now(),
  })
}

export const { authKitEvent } = authKit.events({
  'user.created': (ctx, event) => syncWorkOSUserCreated(ctx, event.data),
  'user.updated': (ctx, event) => syncWorkOSUserUpdated(ctx, event.data),
  'user.deleted': (ctx, event) => syncWorkOSUserDeleted(ctx, event.data),
  'organization_membership.created': (ctx, event) =>
    syncWorkOSMembershipCreated(ctx, event.data),
  'organization_membership.updated': (ctx, event) =>
    syncWorkOSMembershipUpdated(ctx, event.data),
  'organization_membership.deleted': (ctx, event) =>
    syncWorkOSMembershipDeleted(ctx, event.data),
})

export const { backfillUsers } = authKit.utils()

export const { authKitAction } = authKit.actions({
  authentication: (_ctx, _action, response) => {
    return Promise.resolve(response.allow())
  },
  userRegistration: (_ctx, _action, response) => {
    return Promise.resolve(response.allow())
  },
})
