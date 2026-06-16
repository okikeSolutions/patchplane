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
  null
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

async function trustedCreate(
  t: ReturnType<typeof authenticatedTest>,
  args: CreateWorkflowStartArgs = createArgs(),
) {
  const response = await t.fetch('/workflow-starts/create', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-patchplane-convex-write-secret': 'test-write-secret',
    },
    body: JSON.stringify(args),
  })
  const body: unknown = await response.json()

  if (!isWorkflowStartResult(body)) {
    throw new Error('Expected workflow start response body')
  }

  return { response, body }
}

describe('workflowStarts trusted boundary and authz', () => {
  test('rejects direct public creates, including source dev', async () => {
    const t = convexTest(schema, modules)

    await expect(t.mutation(createWorkflowStart, createArgs())).rejects.toThrow(
      'Use trusted workflow start boundary',
    )
    await expect(
      t.mutation(
        createWorkflowStart,
        createArgs({ actorId: 'system:dev', source: 'dev' }),
      ),
    ).rejects.toThrow('Use trusted workflow start boundary')
  })

  test('rejects trusted workflow starts with invalid secret', async () => {
    const t = authenticatedTest()

    const response = await t.fetch('/workflow-starts/create', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-patchplane-convex-write-secret': 'wrong',
      },
      body: JSON.stringify(createArgs()),
    })

    expect(response.status).toBe(401)
  })

  test('allows trusted workflow starts after server-side WorkOS checks', async () => {
    const t = authenticatedTest()

    const { response, body } = await trustedCreate(t)

    expect(response.status).toBe(200)
    expect(body.promptRequest).toMatchObject({
      workspaceId: 'workos:org_123',
      actorId: 'workos:user_123',
      source: 'app',
      prompt: 'Ship it',
    })
  })

  test('listRecent requires active WorkOS organization access', async () => {
    const t = authenticatedTest()
    await seedMembership(t)
    await trustedCreate(t)

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
    await trustedCreate(t)

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
    await trustedCreate(t)

    await expect(
      t.query(listRecentWorkflowStarts, { workspaceId: 'workos:org_123' }),
    ).rejects.toThrow('Permission required')
  })
})
