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
  source: 'dev' | 'app' | 'external'
  traceId: string
  prompt: string
}

interface WorkflowStartResult {
  promptRequest: {
    id: string
    workspaceId: string
    actorId: string
    source: string
    prompt: string
  }
  workflowRun: {
    id: string
  }
}

interface WorkflowDetailResult {
  readonly runtimeEvents?: ReadonlyArray<unknown> | undefined
  readonly evidenceArtifacts?: ReadonlyArray<unknown> | undefined
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

const getWorkflowDetail = makeFunctionReference<
  'query',
  { workflowRunId: string },
  WorkflowDetailResult
>('workflowStarts:getDetail')

const authorizeRuntimeControl = makeFunctionReference<
  'query',
  { workflowRunId: string },
  unknown
>('workflowStarts:authorizeRuntimeControl')

const createWorkflowStartFromExternalIntake = makeFunctionReference<
  'mutation',
  Record<string, unknown>,
  unknown
>('workflowStarts:createFromExternalIntake')

const recordSandboxExecution = makeFunctionReference<
  'mutation',
  Record<string, unknown>,
  unknown
>('workflowStarts:recordSandboxExecution')

const recordRuntimeEvents = makeFunctionReference<
  'mutation',
  Record<string, unknown>,
  Array<Record<string, unknown>>
>('workflowStarts:recordRuntimeEvents')

const recordEvidenceArtifact = makeFunctionReference<
  'mutation',
  Record<string, unknown>,
  Record<string, unknown>
>('workflowStarts:recordEvidenceArtifact')

const getEvidenceArtifact = makeFunctionReference<
  'query',
  Record<string, unknown>,
  Record<string, unknown> | null
>('workflowStarts:getEvidenceArtifact')

const recordRuntimeSessionStarted = makeFunctionReference<
  'mutation',
  Record<string, unknown>,
  unknown
>('workflowStarts:recordRuntimeSessionStarted')

const markRuntimeSessionStatus = makeFunctionReference<
  'mutation',
  Record<string, unknown>,
  unknown
>('workflowStarts:markRuntimeSessionStatus')

const getActiveRuntimeSession = makeFunctionReference<
  'query',
  Record<string, unknown>,
  unknown
>('workflowStarts:getActiveRuntimeSession')

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
  test('system external intake creates a workflow and dedupes redelivery', async () => {
    const t = convexTest(schema, modules)
    const args = {
      systemSecret: 'system_test',
      workspaceId: 'workos:org_123',
      actorId: 'github-app:123',
      actorDisplayName: 'GitHub App installation 123',
      source: 'external',
      traceId: 'trace_github_123',
      prompt: 'Fix auth callback',
      externalRef: {
        provider: 'github',
        deliveryId: 'delivery-1',
        eventKind: 'github.issue.opened',
        repositoryProvider: 'github',
        repositoryInstallationId: '123',
        repositoryExternalId: '456',
        repositoryOwner: 'patchplane',
        repositoryName: 'demo',
        repositoryFullName: 'patchplane/demo',
        issueExternalId: '789',
        issueNumber: 7,
        issueTitle: 'Fix auth callback',
        url: 'https://github.com/patchplane/demo/issues/7',
        senderProvider: 'github',
        senderLogin: 'octocat',
      },
    }

    const first = await t.mutation(createWorkflowStartFromExternalIntake, args)
    const second = await t.mutation(createWorkflowStartFromExternalIntake, {
      ...args,
      traceId: 'trace_github_456',
      externalRef: {
        ...args.externalRef,
        deliveryId: 'delivery-redelivery',
      },
    })

    expect(isWorkflowStartResult(first)).toBe(true)
    expect(isWorkflowStartResult(second)).toBe(true)
    if (!isWorkflowStartResult(first) || !isWorkflowStartResult(second)) {
      throw new Error('Expected workflow start results')
    }

    expect(second.promptRequest.id).toBe(first.promptRequest.id)
    expect(first.promptRequest).toMatchObject({
      workspaceId: 'workos:org_123',
      actorId: 'github-app:123',
      source: 'external',
      prompt: 'Fix auth callback',
    })

    const refs = await t.run((ctx) =>
      ctx.db.query('externalWorkflowRefs').collect(),
    )
    expect(refs).toHaveLength(1)
  })

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
      t.mutation(createWorkflowStart, createArgs({ source: 'external' })),
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

  test('recordSandboxExecution persists normalized sandbox policy metadata', async () => {
    const t = authenticatedTest()
    await seedMembership(t)
    const workflowStart = await createWorkflowStartForTest(t)
    const policy = {
      lifecycle: {
        ephemeral: true,
        retainAfterRun: false,
        autoStopMinutes: 5,
        autoArchiveMinutes: 0,
        autoDeleteMinutes: 0,
      },
      network: { blockAll: false, allowList: '0.0.0.0/0' },
      resources: { cpu: 2, memoryGb: 4, diskGb: 8 },
      timeoutSeconds: 120,
    }

    const result = await t.mutation(recordSandboxExecution, {
      systemSecret: 'system_test',
      workflowRunId: workflowStart.workflowRun.id,
      provider: 'daytona',
      sandboxId: 'sandbox-1',
      command: 'bun test',
      status: 'succeeded',
      exitCode: 0,
      stdout: 'ok',
      policy,
      startedAt: 1,
      completedAt: 2,
    })

    expect(result).toMatchObject({
      provider: 'daytona',
      sandboxId: 'sandbox-1',
      policy,
    })

    const rows = await t.run((ctx) => ctx.db.query('sandboxExecutions').collect())
    expect(rows[0]?.policy).toEqual(policy)
  })

  test('getDetail returns workflow context, runtime events, and sandbox executions', async () => {
    const t = authenticatedTest()
    await seedMembership(t)
    const workflowStart = await createWorkflowStartForTest(t)

    await t.mutation(recordSandboxExecution, {
      systemSecret: 'system_test',
      workflowRunId: workflowStart.workflowRun.id,
      provider: 'daytona',
      sandboxId: 'sandbox-1',
      command: 'bun test',
      status: 'failed',
      exitCode: 1,
      stdout: 'failing test output',
      stderr: 'expected true to be false',
      startedAt: 10,
      completedAt: 20,
    })

    await t.mutation(recordRuntimeEvents, {
      systemSecret: 'system_test',
      events: [
        {
          workflowRunId: workflowStart.workflowRun.id,
          provider: 'pi',
          type: 'agent.started',
          occurredAt: 5,
          summary: 'Agent started',
        },
      ],
    })

    const detail = await t.query(getWorkflowDetail, {
      workflowRunId: workflowStart.workflowRun.id,
    })

    expect(detail).toMatchObject({
      promptRequest: { prompt: 'Ship it' },
      workflowRun: { id: workflowStart.workflowRun.id, status: 'reviewed' },
      runtimeEvents: [{ provider: 'pi', type: 'agent.started' }],
      sandboxExecutions: [{ provider: 'daytona', status: 'failed' }],
    })
  })

  test('records evidence artifact metadata for workflow detail', async () => {
    const t = authenticatedTest()
    await seedMembership(t)
    const workflowStart = await createWorkflowStartForTest(t)

    const artifact = await t.mutation(recordEvidenceArtifact, {
      systemSecret: 'system_test',
      workflowRunId: workflowStart.workflowRun.id,
      traceId: 'trace_123',
      kind: 'stdout',
      label: 'Sandbox stdout',
      storageProvider: 'cloudflare-r2',
      storageKey: 'workflow-1/stdout.txt',
      contentType: 'text/plain; charset=utf-8',
      sizeBytes: 2,
      sha256: '2689367b205c16ce32e8ecd5e2fe58ae6d4acc7ba32d3d116dc92d4c2715f1b5',
      retentionPolicy: 'alpha-14-days',
      createdAt: 10,
    })

    expect(artifact).toMatchObject({
      workflowRunId: workflowStart.workflowRun.id,
      kind: 'stdout',
      storageProvider: 'cloudflare-r2',
      storageKey: 'workflow-1/stdout.txt',
      sizeBytes: 2,
    })

    const detail = await t.query(getWorkflowDetail, {
      workflowRunId: workflowStart.workflowRun.id,
    })
    expect(detail.evidenceArtifacts).toHaveLength(1)
    expect(detail.evidenceArtifacts?.[0]).toMatchObject({
      kind: 'stdout',
      storageKey: 'workflow-1/stdout.txt',
      sha256: '2689367b205c16ce32e8ecd5e2fe58ae6d4acc7ba32d3d116dc92d4c2715f1b5',
    })

    const readBack = await t.query(getEvidenceArtifact, {
      artifactId: artifact.id,
      workflowRunId: workflowStart.workflowRun.id,
    })
    expect(readBack).toMatchObject({
      id: artifact.id,
      workflowRunId: workflowStart.workflowRun.id,
      storageKey: 'workflow-1/stdout.txt',
    })

    const mismatchedWorkflow = await createWorkflowStartForTest(t)
    const mismatchedRead = await t.query(getEvidenceArtifact, {
      artifactId: artifact.id,
      workflowRunId: mismatchedWorkflow.workflowRun.id,
    })
    expect(mismatchedRead).toBeNull()
  })

  test('recordRuntimeEvents dedupes idempotency keys', async () => {
    const t = authenticatedTest()
    await seedMembership(t)
    const workflowStart = await createWorkflowStartForTest(t)

    const event = {
      workflowRunId: workflowStart.workflowRun.id,
      provider: 'pi',
      type: 'pi.agent_start',
      occurredAt: 5,
      summary: 'Pi agent started',
      idempotencyKey: 'session:command:stdout:1:abc',
      sourceSessionId: 'session',
      sourceCommandId: 'command',
      sourceStream: 'stdout',
      sourceLine: 1,
      sourceOffset: 0,
    }

    const first = await t.mutation(recordRuntimeEvents, {
      systemSecret: 'system_test',
      events: [event],
    })
    const second = await t.mutation(recordRuntimeEvents, {
      systemSecret: 'system_test',
      events: [event],
    })

    expect(second[0]?.id).toBe(first[0]?.id)
    const detail = await t.query(getWorkflowDetail, {
      workflowRunId: workflowStart.workflowRun.id,
    })
    expect(detail.runtimeEvents).toHaveLength(1)
    expect(detail.runtimeEvents?.[0]).toMatchObject({
      idempotencyKey: event.idempotencyKey,
      sourceSessionId: 'session',
      sourceCommandId: 'command',
      sourceStream: 'stdout',
      sourceLine: 1,
      sourceOffset: 0,
    })
  })

  test('records and updates active runtime session lifecycle', async () => {
    const t = authenticatedTest()
    await seedMembership(t)
    const workflowStart = await createWorkflowStartForTest(t)

    const started = await t.mutation(recordRuntimeSessionStarted, {
      systemSecret: 'system_test',
      workflowRunId: workflowStart.workflowRun.id,
      provider: 'daytona:pi-rpc',
      sandboxId: 'sandbox-1',
      sessionId: 'session-1',
      commandId: 'cmd-1',
      startedAt: 10,
    })

    expect(started).toMatchObject({
      workflowRunId: workflowStart.workflowRun.id,
      provider: 'daytona:pi-rpc',
      status: 'running',
    })

    await expect(t.query(getActiveRuntimeSession, {
      systemSecret: 'system_test',
      workflowRunId: workflowStart.workflowRun.id,
    })).resolves.toMatchObject({
      sandboxId: 'sandbox-1',
      sessionId: 'session-1',
      commandId: 'cmd-1',
      status: 'running',
    })

    const runtimeSessionId = typeof started === 'object' && started !== null && 'id' in started
      ? started.id
      : undefined
    expect(runtimeSessionId).toBeDefined()

    await t.mutation(markRuntimeSessionStatus, {
      systemSecret: 'system_test',
      runtimeSessionId,
      status: 'cancelled',
      completedAt: 20,
    })

    await expect(t.query(getActiveRuntimeSession, {
      systemSecret: 'system_test',
      workflowRunId: workflowStart.workflowRun.id,
    })).resolves.toBeNull()
  })

  test('authorizeRuntimeControl requires run interrupt permission for workflow workspace', async () => {
    const t = authenticatedTest()
    await seedMembership(t, { permissions: ['workspace:view', 'prompt:create', 'run:interrupt'] })
    const workflowStart = await createWorkflowStartForTest(t)

    await expect(t.query(authorizeRuntimeControl, {
      workflowRunId: workflowStart.workflowRun.id,
    })).resolves.toMatchObject({
      workflowRunId: workflowStart.workflowRun.id,
      workspaceId: 'workos:org_123',
      allowed: true,
    })

    const missingPermission = authenticatedTest()
    await seedMembership(missingPermission, { permissions: ['workspace:view', 'prompt:create'] })
    const otherWorkflowStart = await createWorkflowStartForTest(missingPermission)
    await expect(missingPermission.query(authorizeRuntimeControl, {
      workflowRunId: otherWorkflowStart.workflowRun.id,
    })).rejects.toThrow('Permission required')
  })

  test('getDetail requires active organization access', async () => {
    const t = authenticatedTest()
    await seedMembership(t)
    const workflowStart = await createWorkflowStartForTest(t)

    await expect(
      convexTest(schema, modules).query(getWorkflowDetail, {
        workflowRunId: workflowStart.workflowRun.id,
      }),
    ).rejects.toThrow('Authentication required')
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
