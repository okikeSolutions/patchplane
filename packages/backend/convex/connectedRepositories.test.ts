/// <reference types="vite/client" />
import { makeFunctionReference } from 'convex/server'
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])

const createGitHubConnectionIntent = makeFunctionReference<
  'mutation',
  {
    state: string
    workspaceId: string
    returnPathname?: string
    expiresAt: number
  },
  { state: string }
>('connectedRepositories:createGitHubConnectionIntent')

const consumeGitHubConnectionIntent = makeFunctionReference<
  'mutation',
  { state: string; workspaceId: string },
  { workspaceId: string; actorId: string; returnPathname?: string }
>('connectedRepositories:consumeGitHubConnectionIntent')

const upsertGitHubInstallationRepositories = makeFunctionReference<
  'mutation',
  Record<string, unknown>,
  Array<{ id: string; repositoryFullName: string; workspaceId: string }>
>('connectedRepositories:upsertGitHubInstallationRepositories')

const listForWorkspace = makeFunctionReference<
  'query',
  { workspaceId: string },
  Array<{ repositoryFullName: string }>
>('connectedRepositories:listForWorkspace')

const lookupGitHubWebhookRoute = makeFunctionReference<
  'query',
  {
    systemSecret: string
    installationId: string
    repositoryExternalId: string
  },
  { workspaceId: string; repositoryFullName: string; status: string } | null
>('connectedRepositories:lookupGitHubWebhookRoute')

function authenticatedTest() {
  return convexTest(schema, modules).withIdentity({
    subject: 'user_123',
    organizationId: 'org_123',
  })
}

async function seedMembership(
  t: ReturnType<typeof authenticatedTest>,
  permissions: Array<string> = ['repo:connect', 'workspace:view'],
) {
  await t.run((ctx) =>
    ctx.db.insert('memberships', {
      workosMembershipId: 'om_123',
      authId: 'user_123',
      organizationId: 'org_123',
      status: 'active',
      role: 'operator',
      roles: ['operator'],
      permissions,
      updatedAt: Date.now(),
    }),
  )
}

const connectionArgs = {
  workspaceId: 'workos:org_123',
  account: {
    provider: 'github',
    installationId: '123',
    accountExternalId: '999',
    accountLogin: 'octokit',
    accountType: 'Organization',
  },
  repositories: [
    {
      provider: 'github',
      installationId: '123',
      repositoryExternalId: '456',
      repositoryOwner: 'octokit',
      repositoryName: 'octokit.js',
      repositoryFullName: 'octokit/octokit.js',
      private: true,
      selected: true,
      permissionsJson: JSON.stringify({ contents: 'read', pull_requests: 'read' }),
    },
  ],
}

describe('connectedRepositories', () => {
  test('upserts and lists GitHub installation repositories for the authenticated workspace', async () => {
    const t = authenticatedTest()
    await seedMembership(t)

    const upserted = await t.mutation(upsertGitHubInstallationRepositories, connectionArgs)
    const listed = await t.query(listForWorkspace, { workspaceId: 'workos:org_123' })

    expect(upserted).toHaveLength(1)
    expect(upserted[0]?.workspaceId).toBe('workos:org_123')
    expect(listed.map((repository) => repository.repositoryFullName)).toEqual([
      'octokit/octokit.js',
    ])
  })

  test('looks up active selected repositories for GitHub webhook routing', async () => {
    const t = authenticatedTest()
    await seedMembership(t)
    await t.mutation(upsertGitHubInstallationRepositories, connectionArgs)

    const route = await t.query(lookupGitHubWebhookRoute, {
      systemSecret: 'system_test',
      installationId: '123',
      repositoryExternalId: '456',
    })

    expect(route).toEqual({
      workspaceId: 'workos:org_123',
      repositoryFullName: 'octokit/octokit.js',
      status: 'active',
    })
  })

  test('requires repository connection permission', async () => {
    const t = authenticatedTest()
    await seedMembership(t, ['workspace:view'])

    await expect(
      t.mutation(upsertGitHubInstallationRepositories, connectionArgs),
    ).rejects.toThrow('Permission required')
  })

  test('creates and consumes a GitHub connection intent for the authenticated workspace', async () => {
    const t = authenticatedTest()
    await seedMembership(t)

    await t.mutation(createGitHubConnectionIntent, {
      state: 'state_123',
      workspaceId: 'workos:org_123',
      returnPathname: '/app',
      expiresAt: Date.now() + 60_000,
    })

    const intent = await t.mutation(consumeGitHubConnectionIntent, {
      state: 'state_123',
      workspaceId: 'workos:org_123',
    })

    expect(intent).toEqual({
      workspaceId: 'workos:org_123',
      actorId: 'workos:user_123',
      returnPathname: '/app',
    })
  })

  test('returns null for unknown or wrong-installation webhook routes', async () => {
    const t = authenticatedTest()
    await seedMembership(t)
    await t.mutation(upsertGitHubInstallationRepositories, connectionArgs)

    await expect(t.query(lookupGitHubWebhookRoute, {
      systemSecret: 'system_test',
      installationId: '999',
      repositoryExternalId: '456',
    })).resolves.toBeNull()
    await expect(t.query(lookupGitHubWebhookRoute, {
      systemSecret: 'system_test',
      installationId: '123',
      repositoryExternalId: '999',
    })).resolves.toBeNull()
  })
})
