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

const listForWorkspaceWithLatestVerification = makeFunctionReference<
  'query',
  {
    workspaceId: string
    paginationOpts: { numItems: number; cursor: string | null }
  },
  {
    page: Array<{
      repository: { repositoryFullName: string }
      latestVerification?: {
        workflowRunId: string
        workflowStatus: string
        verificationStatus: string
        pullRequestNumber?: number
      }
    }>
    isDone: boolean
    continueCursor: string
  }
>('connectedRepositories:listForWorkspaceWithLatestVerification')

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

  test('aggregates the latest workspace verification for each connected repository', async () => {
    const t = authenticatedTest()
    await seedMembership(t)
    await t.mutation(upsertGitHubInstallationRepositories, connectionArgs)

    const seeded = await t.run(async (ctx) => {
      const insertWorkflow = async (
        workspaceId: string,
        traceId: string,
        status: 'queued' | 'running' | 'reviewed',
        pullRequestNumber: number,
      ) => {
        const promptRequestId = await ctx.db.insert('promptRequests', {
          workspaceId,
          actorId: 'github-app:123',
          actorDisplayName: 'GitHub App installation 123',
          traceId,
          source: 'external',
          prompt: 'Verify the pull request',
          status: 'created',
          createdAt: pullRequestNumber,
        })
        const workflowRunId = await ctx.db.insert('workflowRuns', {
          promptRequestId,
          workspaceId,
          traceId,
          status,
          createdAt: pullRequestNumber,
        })
        await ctx.db.insert('externalWorkflowRefs', {
          provider: 'github',
          workspaceId,
          deliveryId: `delivery-${traceId}`,
          eventKind: 'github.pull_request.synchronize',
          repositoryProvider: 'github',
          repositoryInstallationId: '123',
          repositoryExternalId: '456',
          repositoryOwner: 'octokit',
          repositoryName: 'octokit.js',
          repositoryFullName: 'octokit/octokit.js',
          pullRequestNumber,
          promptRequestId,
          workflowRunId,
          createdAt: pullRequestNumber,
        })
        return workflowRunId
      }

      await insertWorkflow('workos:org_123', 'trace-old', 'reviewed', 1)
      const latestWorkflowRunId = await insertWorkflow(
        'workos:org_123',
        'trace-latest',
        'reviewed',
        2,
      )
      const reviewRunId = await ctx.db.insert('reviewRuns', {
        workflowRunId: latestWorkflowRunId,
        kind: 'test',
        reviewer: 'patchplane:test-reviewer',
        status: 'completed',
        startedAt: 10,
        completedAt: 11,
        createdAt: 10,
      })
      const policyDecisionId = await ctx.db.insert('policyDecisions', {
        workflowRunId: latestWorkflowRunId,
        reviewRunId,
        status: 'approved',
        summary: 'Automated checks passed.',
        createdAt: 12,
      })
      await ctx.db.insert('humanDecisions', {
        workflowRunId: latestWorkflowRunId,
        reviewRunId,
        policyDecisionId,
        actorId: 'workos:user_123',
        status: 'approved',
        comment: 'Evidence reviewed.',
        decidedAt: 20,
      })
      // A newer ref from another workspace must never leak into this workspace.
      await insertWorkflow('workos:org_other', 'trace-other', 'running', 3)
      return { latestWorkflowRunId }
    })

    const listed = await t.query(listForWorkspaceWithLatestVerification, {
      workspaceId: 'workos:org_123',
      paginationOpts: { numItems: 20, cursor: null },
    })

    expect(listed.page).toHaveLength(1)
    expect(listed.page[0]?.repository.repositoryFullName).toBe('octokit/octokit.js')
    expect(listed.page[0]?.latestVerification).toEqual({
      workflowRunId: seeded.latestWorkflowRunId,
      workflowStatus: 'reviewed',
      verificationStatus: 'approved',
      pullRequestNumber: 2,
      createdAt: 2,
      updatedAt: 20,
    })

    await t.run(async (ctx) => {
      const reviewRunId = await ctx.db.insert('reviewRuns', {
        workflowRunId: seeded.latestWorkflowRunId,
        kind: 'test',
        reviewer: 'patchplane:test-reviewer',
        status: 'completed',
        startedAt: 30,
        completedAt: 31,
        createdAt: 30,
      })
      await ctx.db.insert('policyDecisions', {
        workflowRunId: seeded.latestWorkflowRunId,
        reviewRunId,
        status: 'changes-requested',
        summary: 'A newer verification failed.',
        createdAt: 32,
      })
    })
    const afterRerun = await t.query(listForWorkspaceWithLatestVerification, {
      workspaceId: 'workos:org_123',
      paginationOpts: { numItems: 20, cursor: null },
    })
    expect(afterRerun.page[0]?.latestVerification?.verificationStatus).toBe(
      'changes-requested',
    )
  })

  test('returns no latest verification when a connected repository has no workflow', async () => {
    const t = authenticatedTest()
    await seedMembership(t)
    await t.mutation(upsertGitHubInstallationRepositories, connectionArgs)

    const listed = await t.query(listForWorkspaceWithLatestVerification, {
      workspaceId: 'workos:org_123',
      paginationOpts: { numItems: 20, cursor: null },
    })

    expect(listed.page[0]).toMatchObject({
      repository: { repositoryFullName: 'octokit/octokit.js' },
    })
    expect(listed.page[0]?.latestVerification).toBeUndefined()

    const legacyWorkflowRunId = await t.run(async (ctx) => {
      const promptRequestId = await ctx.db.insert('promptRequests', {
        workspaceId: 'workos:org_123',
        actorId: 'github-app:123',
        actorDisplayName: 'GitHub App installation 123',
        traceId: 'trace-legacy',
        source: 'external',
        prompt: 'Verify the pull request',
        status: 'created',
        createdAt: 1,
      })
      const workflowRunId = await ctx.db.insert('workflowRuns', {
        promptRequestId,
        workspaceId: 'workos:org_123',
        traceId: 'trace-legacy',
        status: 'running',
        createdAt: 1,
      })
      await ctx.db.insert('externalWorkflowRefs', {
        provider: 'github',
        deliveryId: 'delivery-legacy',
        eventKind: 'github.pull_request.synchronize',
        repositoryExternalId: '456',
        promptRequestId,
        workflowRunId,
        createdAt: 1,
      })
      const otherPromptRequestId = await ctx.db.insert('promptRequests', {
        workspaceId: 'workos:org_other',
        actorId: 'github-app:123',
        actorDisplayName: 'GitHub App installation 123',
        traceId: 'trace-legacy-other',
        source: 'external',
        prompt: 'Verify another workspace pull request',
        status: 'created',
        createdAt: 2,
      })
      const otherWorkflowRunId = await ctx.db.insert('workflowRuns', {
        promptRequestId: otherPromptRequestId,
        workspaceId: 'workos:org_other',
        traceId: 'trace-legacy-other',
        status: 'reviewed',
        createdAt: 2,
      })
      await ctx.db.insert('externalWorkflowRefs', {
        provider: 'github',
        deliveryId: 'delivery-legacy-other',
        eventKind: 'github.pull_request.synchronize',
        repositoryExternalId: '456',
        promptRequestId: otherPromptRequestId,
        workflowRunId: otherWorkflowRunId,
        createdAt: 2,
      })
      return workflowRunId
    })
    const withLegacyWorkflow = await t.query(
      listForWorkspaceWithLatestVerification,
      {
        workspaceId: 'workos:org_123',
        paginationOpts: { numItems: 20, cursor: null },
      },
    )
    expect(withLegacyWorkflow.page[0]?.latestVerification).toMatchObject({
      workflowRunId: legacyWorkflowRunId,
      verificationStatus: 'running',
    })

    await expect(
      t.query(listForWorkspaceWithLatestVerification, {
        workspaceId: 'workos:org_123',
        paginationOpts: { numItems: 51, cursor: null },
      }),
    ).rejects.toThrow('Repository page size must not exceed 50')
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
