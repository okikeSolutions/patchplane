/// <reference types="vite/client" />
import { makeFunctionReference } from 'convex/server'
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])

type CreateWorkflowStartArgs = Record<string, unknown> & {
  workspaceId: string
  actorId: string
  actorDisplayName: string
  source: 'dev' | 'app' | 'github_issue' | 'github_pr_comment'
  traceId: string
  prompt: string
}

interface WorkflowStartResult {
  promptRequest: {
    workspaceId: string
    actorId: string
    source: string
    prompt: string
  }
}

const createWorkflowStart = makeFunctionReference<
  'mutation',
  CreateWorkflowStartArgs,
  unknown
>('workflowStarts:create')

const listRecentWorkflowStarts = makeFunctionReference<
  'query',
  { workspaceId: string; limit?: number },
  Array<unknown>
>('workflowStarts:listRecent')

function createArgs(overrides: Partial<CreateWorkflowStartArgs> = {}) {
  return {
    workspaceId: 'workos:org_123',
    actorId: 'workos:user_123',
    actorDisplayName: 'Ada Lovelace',
    source: 'app' as const,
    traceId: 'trace_123',
    prompt: 'Ship it',
    ...overrides,
  }
}

function authenticatedTest() {
  return convexTest(schema, modules).withIdentity({
    subject: 'user_123',
    organizationId: 'org_123',
  })
}

async function seedMembership(
  t: ReturnType<typeof authenticatedTest>,
  overrides: Partial<{
    workosMembershipId: string
    authId: string
    organizationId: string
    status: 'active' | 'inactive' | 'pending' | 'deleted'
    role: string
    roles: Array<string>
    permissions: Array<string>
  }> = {},
) {
  await t.run((ctx) =>
    ctx.db.insert('memberships', {
      workosMembershipId: 'om_123',
      authId: 'user_123',
      organizationId: 'org_123',
      status: 'active',
      role: 'operator',
      roles: ['operator'],
      permissions: ['workspace:view', 'prompt:create', 'run:start'],
      updatedAt: Date.now(),
      ...overrides,
    }),
  )
}

function isWorkflowStartResult(value: unknown): value is WorkflowStartResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'promptRequest' in value &&
    typeof value.promptRequest === 'object' &&
    value.promptRequest !== null
  )
}

async function createWorkflowStartForTest(
  t: ReturnType<typeof authenticatedTest>,
  args: CreateWorkflowStartArgs = createArgs(),
) {
  const result = await t.mutation(createWorkflowStart, args)

  if (!isWorkflowStartResult(result)) {
    throw new Error('Expected workflow start result')
  }

  return result
}

describe('workflowStarts trusted boundary and authz', () => {
  test('public workflow start requires authentication', async () => {
    const t = convexTest(schema, modules)

    await expect(t.mutation(createWorkflowStart, createArgs())).rejects.toThrow(
      'Authentication required',
    )
  })

  test('public workflow start requires active organization membership and prompt:create', async () => {
    const t = authenticatedTest()

    await expect(t.mutation(createWorkflowStart, createArgs())).rejects.toThrow(
      'Active membership required',
    )

    await seedMembership(t, {
      role: 'viewer',
      roles: ['viewer'],
      permissions: ['workspace:view'],
    })

    await expect(t.mutation(createWorkflowStart, createArgs())).rejects.toThrow(
      'Permission required',
    )
  })

  test('public workflow start rejects workspace, actor, and source spoofing', async () => {
    const t = authenticatedTest()
    await seedMembership(t)

    await expect(
      t.mutation(createWorkflowStart, createArgs({ workspaceId: 'workos:org_456' })),
    ).rejects.toThrow('Workspace mismatch')

    await expect(
      t.mutation(createWorkflowStart, createArgs({ actorId: 'workos:user_456' })),
    ).rejects.toThrow('Actor mismatch')

    await expect(
      t.mutation(createWorkflowStart, createArgs({ source: 'github_issue' })),
    ).rejects.toThrow('App workflow source required')
  })

  test('public workflow start succeeds with active membership and prompt:create', async () => {
    const t = authenticatedTest()
    await seedMembership(t)

    const result = await t.mutation(createWorkflowStart, createArgs())

    expect(isWorkflowStartResult(result)).toBe(true)
    if (!isWorkflowStartResult(result)) {
      throw new Error('Expected workflow start result')
    }
    expect(result.promptRequest).toMatchObject({
      workspaceId: 'workos:org_123',
      actorId: 'workos:user_123',
      source: 'app',
      prompt: 'Ship it',
    })
  })

  test('public workflow start tolerates duplicate mirrored memberships', async () => {
    const t = authenticatedTest()
    await seedMembership(t, {
      permissions: ['workspace:view'],
      workosMembershipId: 'om_viewer',
    })
    await seedMembership(t, {
      permissions: ['workspace:view', 'prompt:create'],
      workosMembershipId: 'om_operator',
    })

    const result = await t.mutation(createWorkflowStart, createArgs())

    expect(isWorkflowStartResult(result)).toBe(true)
  })

  test('listRecent requires active WorkOS organization access', async () => {
    const t = authenticatedTest()
    await seedMembership(t)
    await createWorkflowStartForTest(t)

    await expect(
      convexTest(schema, modules).query(listRecentWorkflowStarts, {
        workspaceId: 'workos:org_123',
      }),
    ).rejects.toThrow('Authentication required')

    await expect(
      t.query(listRecentWorkflowStarts, { workspaceId: 'workos:org_456' }),
    ).rejects.toThrow('Workspace mismatch')

    await expect(
      t.query(listRecentWorkflowStarts, { workspaceId: 'workos:org_123' }),
    ).resolves.toHaveLength(1)
  })

  test('listRecent rejects missing mirrored membership', async () => {
    const t = authenticatedTest()

    await expect(
      t.query(listRecentWorkflowStarts, { workspaceId: 'workos:org_123' }),
    ).rejects.toThrow('Active membership required')
  })

  test('listRecent rejects missing workspace:view permission', async () => {
    const t = authenticatedTest()
    await seedMembership(t, {
      role: 'custom',
      roles: ['custom'],
      permissions: ['prompt:create'],
    })
    await createWorkflowStartForTest(t)

    await expect(
      t.query(listRecentWorkflowStarts, { workspaceId: 'workos:org_123' }),
    ).rejects.toThrow('Permission required')
  })
})
