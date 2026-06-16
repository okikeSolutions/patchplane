/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import {
  syncWorkOSMembershipCreated,
  syncWorkOSMembershipDeleted,
  syncWorkOSMembershipUpdated,
  syncWorkOSUserCreated,
  syncWorkOSUserDeleted,
  syncWorkOSUserUpdated,
} from './auth'
import schema from './schema'

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])

function testUser(overrides: Partial<Parameters<typeof syncWorkOSUserCreated>[1]> = {}) {
  return {
    id: 'user_123',
    email: 'ada@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    ...overrides,
  }
}

function testMembership(
  overrides: Partial<Parameters<typeof syncWorkOSMembershipCreated>[1]> = {},
) {
  return {
    id: 'om_123',
    organizationId: 'org_123',
    userId: 'user_123',
    status: 'active' as const,
    role: { slug: 'operator' },
    roles: [{ slug: 'operator' }],
    ...overrides,
  }
}

describe('WorkOS user sync', () => {
  test('user.created inserts an active app user', async () => {
    const t = convexTest(schema, modules)

    await t.run((ctx) => syncWorkOSUserCreated(ctx, testUser()))

    const user = await t.run((ctx) =>
      ctx.db
        .query('users')
        .withIndex('by_auth_id', (q) => q.eq('authId', 'user_123'))
        .unique(),
    )

    expect(user).toMatchObject({
      authId: 'user_123',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      firstName: 'Ada',
      lastName: 'Lovelace',
      status: 'active',
    })
    expect(user?.deletedAt).toBeUndefined()
  })

  test('user.updated patches an existing app user', async () => {
    const t = convexTest(schema, modules)

    await t.run((ctx) => syncWorkOSUserCreated(ctx, testUser()))
    await t.run((ctx) =>
      syncWorkOSUserUpdated(
        ctx,
        testUser({ email: 'ada.updated@example.com', firstName: 'Augusta' }),
      ),
    )

    const user = await t.run((ctx) =>
      ctx.db
        .query('users')
        .withIndex('by_auth_id', (q) => q.eq('authId', 'user_123'))
        .unique(),
    )

    expect(user).toMatchObject({
      authId: 'user_123',
      email: 'ada.updated@example.com',
      name: 'Augusta Lovelace',
      firstName: 'Augusta',
      lastName: 'Lovelace',
      status: 'active',
    })
  })

  test('user.deleted soft deletes an existing app user', async () => {
    const t = convexTest(schema, modules)

    await t.run((ctx) => syncWorkOSUserCreated(ctx, testUser()))
    await t.run((ctx) => syncWorkOSUserDeleted(ctx, { id: 'user_123' }))

    const user = await t.run((ctx) =>
      ctx.db
        .query('users')
        .withIndex('by_auth_id', (q) => q.eq('authId', 'user_123'))
        .unique(),
    )

    expect(user).toMatchObject({
      authId: 'user_123',
      status: 'deleted',
    })
    expect(user?.deletedAt).toEqual(expect.any(Number))
  })

  test('user.created reactivates and clears deletedAt on an existing app user', async () => {
    const t = convexTest(schema, modules)

    await t.run((ctx) => syncWorkOSUserCreated(ctx, testUser()))
    await t.run((ctx) => syncWorkOSUserDeleted(ctx, { id: 'user_123' }))
    await t.run((ctx) => syncWorkOSUserCreated(ctx, testUser()))

    const user = await t.run((ctx) =>
      ctx.db
        .query('users')
        .withIndex('by_auth_id', (q) => q.eq('authId', 'user_123'))
        .unique(),
    )

    expect(user).toMatchObject({
      authId: 'user_123',
      status: 'active',
    })
    expect(user?.deletedAt).toBeUndefined()
  })
})

describe('WorkOS membership sync', () => {
  test('organization_membership.created inserts permissions for the role', async () => {
    const t = convexTest(schema, modules)

    await t.run((ctx) => syncWorkOSMembershipCreated(ctx, testMembership()))

    const membership = await t.run((ctx) =>
      ctx.db
        .query('memberships')
        .withIndex('by_workos_membership_id', (q) =>
          q.eq('workosMembershipId', 'om_123'),
        )
        .unique(),
    )

    expect(membership).toMatchObject({
      workosMembershipId: 'om_123',
      authId: 'user_123',
      organizationId: 'org_123',
      status: 'active',
      role: 'operator',
      roles: ['operator'],
    })
    expect(membership?.permissions).toContain('workspace:view')
    expect(membership?.permissions).toContain('prompt:create')
    expect(membership?.deletedAt).toBeUndefined()
  })

  test('organization_membership.updated replaces role permissions', async () => {
    const t = convexTest(schema, modules)

    await t.run((ctx) => syncWorkOSMembershipCreated(ctx, testMembership()))
    await t.run((ctx) =>
      syncWorkOSMembershipUpdated(
        ctx,
        testMembership({ role: { slug: 'viewer' }, roles: [{ slug: 'viewer' }] }),
      ),
    )

    const membership = await t.run((ctx) =>
      ctx.db
        .query('memberships')
        .withIndex('by_workos_membership_id', (q) =>
          q.eq('workosMembershipId', 'om_123'),
        )
        .unique(),
    )

    expect(membership).toMatchObject({
      workosMembershipId: 'om_123',
      status: 'active',
      role: 'viewer',
      roles: ['viewer'],
      permissions: ['workspace:view'],
    })
  })

  test('organization_membership.deleted soft deletes membership', async () => {
    const t = convexTest(schema, modules)

    await t.run((ctx) => syncWorkOSMembershipCreated(ctx, testMembership()))
    await t.run((ctx) => syncWorkOSMembershipDeleted(ctx, testMembership()))

    const membership = await t.run((ctx) =>
      ctx.db
        .query('memberships')
        .withIndex('by_workos_membership_id', (q) =>
          q.eq('workosMembershipId', 'om_123'),
        )
        .unique(),
    )

    expect(membership).toMatchObject({
      workosMembershipId: 'om_123',
      status: 'deleted',
    })
    expect(membership?.deletedAt).toEqual(expect.any(Number))
  })

  test('organization_membership.created reactivates and clears deletedAt', async () => {
    const t = convexTest(schema, modules)

    await t.run((ctx) => syncWorkOSMembershipCreated(ctx, testMembership()))
    await t.run((ctx) => syncWorkOSMembershipDeleted(ctx, testMembership()))
    await t.run((ctx) => syncWorkOSMembershipCreated(ctx, testMembership()))

    const membership = await t.run((ctx) =>
      ctx.db
        .query('memberships')
        .withIndex('by_workos_membership_id', (q) =>
          q.eq('workosMembershipId', 'om_123'),
        )
        .unique(),
    )

    expect(membership).toMatchObject({
      workosMembershipId: 'om_123',
      status: 'active',
    })
    expect(membership?.deletedAt).toBeUndefined()
  })
})
