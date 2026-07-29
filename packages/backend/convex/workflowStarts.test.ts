/// <reference types="vite/client" />
import { makeFunctionReference } from 'convex/server'
import type { Id } from './_generated/dataModel'
import { convexTest } from 'convex-test'
import { describe, expect, test, vi } from 'vitest'
import schema from './schema'

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])

function normalizeCanonicalJson(candidate: unknown): unknown {
  if (Array.isArray(candidate)) return candidate.map(normalizeCanonicalJson)
  if (candidate !== null && typeof candidate === 'object') {
    const entries = Object.entries(candidate).filter(
      ([, entry]) => entry !== undefined,
    )
    for (let index = 1; index < entries.length; index += 1) {
      const current = entries[index]
      if (current === undefined) continue
      let position = index - 1
      while (position >= 0) {
        const previous = entries[position]
        if (previous === undefined || previous[0] <= current[0]) break
        entries[position + 1] = previous
        position -= 1
      }
      entries[position + 1] = current
    }
    return Object.fromEntries(
      entries.map(([key, entry]) => [key, normalizeCanonicalJson(entry)]),
    )
  }
  return candidate
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeCanonicalJson(value))
}

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
    id: Id<'promptRequests'>
    workspaceId: string
    actorId: string
    source: string
    prompt: string
  }
  workflowRun: {
    id: Id<'workflowRuns'>
    modelVersion?: 'v1' | undefined
    candidateIdentityVersion?: 'incoming-pr-v1' | undefined
    sourceBaseSha?: string | undefined
    sourceCommitSha?: string | undefined
  }
}

interface WorkflowDetailResult {
  readonly workflowRun: {
    readonly id: string
  }
  readonly newerAttempt?: {
    readonly workflowRunId: string
    readonly attemptNumber: number
    readonly status: 'queued' | 'running' | 'reviewed' | 'failed'
    readonly createdAt: number
  }
  readonly runtimeEvents: ReadonlyArray<{
    readonly type: string
    readonly payloadJson?: string | undefined
  }>
  readonly runtimeEventsTruncated: boolean
  readonly sandboxExecutions: ReadonlyArray<{
    readonly sandboxId: string
    readonly command: string
    readonly runtimeModel?: string | undefined
    readonly stdout: string
    readonly stderr?: string | undefined
  }>
  readonly sandboxExecutionsTruncated: boolean
  readonly evidenceArtifacts?: ReadonlyArray<unknown> | undefined
  readonly candidatePatchSets?: ReadonlyArray<unknown> | undefined
  readonly verificationRequirements: ReadonlyArray<unknown>
  readonly verificationRequirementsTruncated: boolean
  readonly verificationResults: ReadonlyArray<unknown>
  readonly verificationResultsTruncated: boolean
  readonly reviewRuns?: ReadonlyArray<unknown> | undefined
  readonly reviewFindings?: ReadonlyArray<unknown> | undefined
  readonly policyDecisions?: ReadonlyArray<unknown> | undefined
  readonly humanDecisions?: ReadonlyArray<unknown> | undefined
  readonly publicationResults?: ReadonlyArray<unknown> | undefined
  readonly provenanceEvents?: ReadonlyArray<Record<string, unknown>> | undefined
}

const recordQueuedGitHubDelivery = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    deliveryId: string
    envelopeStorageKey: string
    envelopeSha256: string
    deliveryToken: string
  },
  { accepted: boolean; deliveryToken?: string }
>('workflowStarts:recordQueuedGitHubDelivery')
const bindQueuedGitHubDeliveryToWorkflow = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    deliveryId: string
    workflowRunId: string
    repositoryExternalId: string
    issueExternalId: string
    pullRequestBaseSha: string
    pullRequestHeadSha: string
  },
  'bound' | 'coalesced' | 'rejected'
>('workflowStarts:bindQueuedGitHubDeliveryToWorkflow')
const getTrustLoopWorkflowForDelivery = makeFunctionReference<
  'query',
  { systemSecret: string; deliveryId: string },
  { workflowRunId?: string }
>('workflowStarts:getTrustLoopWorkflowForDelivery')
const claimStaleGitHubDeliveries = makeFunctionReference<
  'mutation',
  { systemSecret: string },
  Array<Record<string, unknown>>
>('workflowStarts:claimStaleGitHubDeliveries')

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

const getTrustLoopAcceptanceSnapshot = makeFunctionReference<
  'query',
  { systemSecret: string; workflowRunId: string },
  Record<string, unknown>
>('workflowStarts:getTrustLoopAcceptanceSnapshot')

const getDecisionPublicationReplayFixture = makeFunctionReference<
  'query',
  {
    systemSecret: string
    workflowRunId: string
    humanDecisionId: string
  },
  Record<string, unknown>
>('workflowStarts:getDecisionPublicationReplayFixture')

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
  Record<string, unknown> & { id: Id<'sandboxExecutions'> }
>('workflowStarts:recordSandboxExecution')

const claimWorkflowExecution = makeFunctionReference<
  'mutation',
  { systemSecret: string; workflowRunId: string },
  boolean
>('workflowStarts:claimWorkflowExecution')

const markWorkflowExecutionFailed = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workflowRunId: string
    incomingDispatchToken?: string
    summary: string
  },
  boolean
>('workflowStarts:markWorkflowExecutionFailed')

const createWorkflowRerun = makeFunctionReference<
  'mutation',
  { parentWorkflowRunId: string; reason: string; idempotencyKey: string },
  unknown
>('workflowStarts:createRerun')

const getWorkflowExecutionFixture = makeFunctionReference<
  'query',
  { systemSecret: string; workflowRunId: string },
  unknown
>('workflowStarts:getWorkflowExecutionFixture')

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

const getCandidatePatchSetForWorkflow = makeFunctionReference<
  'query',
  Record<string, unknown>,
  unknown
>('workflowStarts:getCandidatePatchSetForWorkflow')

const claimCandidateFreeze = makeFunctionReference<
  'mutation',
  Record<string, unknown>,
  boolean
>('workflowStarts:claimCandidateFreeze')

const releaseCandidateFreeze = makeFunctionReference<
  'mutation',
  Record<string, unknown>,
  boolean
>('workflowStarts:releaseCandidateFreeze')

const claimIncomingDispatch = makeFunctionReference<
  'mutation',
  Record<string, unknown>,
  boolean
>('workflowStarts:claimIncomingDispatch')

const startIncomingDispatch = makeFunctionReference<
  'mutation',
  Record<string, unknown>,
  boolean
>('workflowStarts:startIncomingDispatch')

const validateIncomingDispatch = makeFunctionReference<
  'mutation',
  Record<string, unknown>,
  boolean
>('workflowStarts:validateIncomingDispatch')

const recordCandidatePatchSet = makeFunctionReference<
  'mutation',
  Record<string, unknown>,
  Record<string, unknown>
>('workflowStarts:recordCandidatePatchSet')

const recordVerificationPlan = makeFunctionReference<
  'mutation',
  Record<string, unknown>,
  Record<string, unknown> & { id: Id<'verificationPlans'> }
>('workflowStarts:recordVerificationPlan')

const recordVerificationRequirement = makeFunctionReference<
  'mutation',
  Record<string, unknown>,
  Record<string, unknown> & { id: Id<'verificationRequirements'> }
>('workflowStarts:recordVerificationRequirement')

const recordVerificationResult = makeFunctionReference<
  'mutation',
  Record<string, unknown>,
  Record<string, unknown> & { id: Id<'verificationResults'> }
>('workflowStarts:recordVerificationResult')

const recordReviewRun = makeFunctionReference<
  'mutation',
  Record<string, unknown>,
  Record<string, unknown>
>('workflowStarts:recordReviewRun')

const recordReviewFinding = makeFunctionReference<
  'mutation',
  Record<string, unknown>,
  Record<string, unknown>
>('workflowStarts:recordReviewFinding')

const recordPolicyDecision = makeFunctionReference<
  'mutation',
  Record<string, unknown>,
  Record<string, unknown>
>('workflowStarts:recordPolicyDecision')

const recordHumanDecision = makeFunctionReference<
  'mutation',
  Record<string, unknown>,
  Record<string, unknown>
>('workflowStarts:recordHumanDecision')

const recordPublicationResult = makeFunctionReference<
  'mutation',
  Record<string, unknown>,
  Record<string, unknown>
>('workflowStarts:recordPublicationResult')

const recordProvenanceEvent = makeFunctionReference<
  'mutation',
  Record<string, unknown>,
  Record<string, unknown>
>('workflowStarts:recordProvenanceEvent')

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

  await t.run((ctx) =>
    ctx.db.patch('workflowRuns', result.workflowRun.id, {
      modelVersion: 'v1',
      rootWorkflowRunId: result.workflowRun.id,
      attemptNumber: 1,
      trigger: 'intake',
      sourceBaseSha: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
      sourceCommitSha: '0123456789012345678901234567890123456789',
    }),
  )
  return result
}

async function claimWorkflowForTest(
  t: ReturnType<typeof authenticatedTest>,
  workflowRunId: Id<'workflowRuns'>,
) {
  expect(
    await t.mutation(claimWorkflowExecution, {
      systemSecret: 'system_test',
      workflowRunId,
    }),
  ).toBe(true)
}

async function seedDecisionPublicationReplayFixture(
  t: ReturnType<typeof authenticatedTest>,
) {
  const workflowStart = await createWorkflowStartForTest(t)
  const workflowRunId = workflowStart.workflowRun.id
  const records = await t.run(async (ctx) => {
    await ctx.db.insert('sandboxExecutions', {
      workflowRunId,
      provider: 'daytona',
      sandboxId: 'sandbox-old',
      command: 'bun test',
      status: 'failed',
      stdout: 'old output',
      startedAt: 1,
      completedAt: 2,
      createdAt: 2,
    })
    const sandboxExecutionId = await ctx.db.insert('sandboxExecutions', {
      workflowRunId,
      provider: 'daytona',
      sandboxId: 'sandbox-latest',
      command: 'bun test',
      status: 'succeeded',
      exitCode: 0,
      stdout: 'latest output',
      startedAt: 3,
      completedAt: 4,
      createdAt: 4,
    })
    await ctx.db.insert('candidatePatchSets', {
      workflowRunId,
      status: 'empty',
      createdAt: 2,
    })
    const candidatePatchSetId = await ctx.db.insert('candidatePatchSets', {
      workflowRunId,
      status: 'captured',
      headSha: 'head-sha',
      createdAt: 4,
    })
    const humanDecisionId = await ctx.db.insert('humanDecisions', {
      workflowRunId,
      sandboxExecutionId,
      candidatePatchSetId,
      actorId: 'workos:user_123',
      status: 'approved',
      comment: 'Evidence is sufficient.',
      decidedAt: 5,
      idempotencyKey: 'decision-request-1',
    })
    await ctx.db.insert('candidatePatchSets', {
      workflowRunId,
      status: 'captured',
      headSha: 'post-decision-head-sha',
      createdAt: 6,
    })
    const issueCommentId = await ctx.db.insert('publicationResults', {
      workflowRunId,
      provider: 'github',
      kind: 'issue-comment',
      status: 'published',
      externalId: 'comment-1',
      createdAt: 6,
      idempotencyKey: `${String(humanDecisionId)}:issue-comment`,
    })
    const checkRunId = await ctx.db.insert('publicationResults', {
      workflowRunId,
      provider: 'github',
      kind: 'check-run',
      status: 'failed',
      error: 'retry me',
      createdAt: 7,
      idempotencyKey: `${String(humanDecisionId)}:check-run`,
    })
    await ctx.db.insert('publicationResults', {
      workflowRunId,
      provider: 'github',
      kind: 'check-run',
      status: 'published',
      createdAt: 8,
      idempotencyKey: `${String(humanDecisionId)}:check-run:unrelated`,
    })

    return {
      humanDecisionId,
      sandboxExecutionId,
      candidatePatchSetId,
      issueCommentId,
      checkRunId,
    }
  })

  return { workflowStart, ...records }
}

describe('workflowStarts webhook queue receipts', () => {
  test('leases a digest-bound envelope and only reclaims it after expiry', async () => {
    const t = authenticatedTest()
    vi.spyOn(Date, 'now').mockReturnValue(1_000)
    expect(
      await t.mutation(recordQueuedGitHubDelivery, {
        systemSecret: 'system_test',
        deliveryId: 'delivery-1',
        envelopeStorageKey: `webhook-queue/github/delivery-1/${'a'.repeat(64)}.json`,
        envelopeSha256: 'a'.repeat(64),
        deliveryToken: 'delivery-token-1',
      }),
    ).toEqual({ accepted: true, deliveryToken: 'delivery-token-1' })
    expect(
      await t.mutation(recordQueuedGitHubDelivery, {
        systemSecret: 'system_test',
        deliveryId: 'delivery-1',
        envelopeStorageKey: `webhook-queue/github/delivery-1/${'a'.repeat(64)}.json`,
        envelopeSha256: 'a'.repeat(64),
        deliveryToken: 'replacement-token',
      }),
    ).toEqual({ accepted: true, deliveryToken: 'delivery-token-1' })

    await seedMembership(t)
    const workflowStart = (await t.mutation(
      createWorkflowStart,
      createArgs(),
    )) as WorkflowStartResult
    await t.run((ctx) =>
      ctx.db.insert('externalWorkflowRefs', {
        provider: 'github',
        workspaceId: 'workos:org_123',
        deliveryId: 'original-delivery',
        eventKind: 'github.pull_request.opened',
        repositoryExternalId: 'repo-1',
        issueExternalId: 'pr-1',
        pullRequestBaseSha: 'a'.repeat(40),
        pullRequestHeadSha: 'b'.repeat(40),
        promptRequestId: workflowStart.promptRequest.id,
        workflowRunId: workflowStart.workflowRun.id,
        createdAt: 1_000,
      }),
    )
    expect(
      await t.mutation(bindQueuedGitHubDeliveryToWorkflow, {
        systemSecret: 'system_test',
        deliveryId: 'delivery-1',
        workflowRunId: workflowStart.workflowRun.id,
        repositoryExternalId: 'repo-1',
        issueExternalId: 'pr-1',
        pullRequestBaseSha: 'a'.repeat(40),
        pullRequestHeadSha: 'b'.repeat(40),
      }),
    ).toBe('bound')
    expect(
      await t.query(getTrustLoopWorkflowForDelivery, {
        systemSecret: 'system_test',
        deliveryId: 'delivery-1',
      }),
    ).toEqual({ workflowRunId: workflowStart.workflowRun.id })

    expect(
      await t.mutation(recordQueuedGitHubDelivery, {
        systemSecret: 'system_test',
        deliveryId: 'delivery-2',
        envelopeStorageKey: `webhook-queue/github/delivery-2/${'c'.repeat(64)}.json`,
        envelopeSha256: 'c'.repeat(64),
        deliveryToken: 'delivery-token-2',
      }),
    ).toEqual({ accepted: true, deliveryToken: 'delivery-token-2' })
    expect(
      await t.mutation(bindQueuedGitHubDeliveryToWorkflow, {
        systemSecret: 'system_test',
        deliveryId: 'delivery-2',
        workflowRunId: workflowStart.workflowRun.id,
        repositoryExternalId: 'repo-1',
        issueExternalId: 'pr-1',
        pullRequestBaseSha: 'a'.repeat(40),
        pullRequestHeadSha: 'b'.repeat(40),
      }),
    ).toBe('coalesced')
    expect(
      await t.query(getTrustLoopWorkflowForDelivery, {
        systemSecret: 'system_test',
        deliveryId: 'delivery-2',
      }),
    ).toEqual({ workflowRunId: workflowStart.workflowRun.id })

    expect(
      await t.mutation(claimStaleGitHubDeliveries, {
        systemSecret: 'system_test',
      }),
    ).toEqual([])

    vi.spyOn(Date, 'now').mockReturnValue(60 * 60 * 1_000 + 1_001)
    expect(
      await t.mutation(claimStaleGitHubDeliveries, {
        systemSecret: 'system_test',
      }),
    ).toEqual([
      expect.objectContaining({
        deliveryId: 'delivery-1',
        envelopeSha256: 'a'.repeat(64),
      }),
    ])
    vi.restoreAllMocks()
  })
})

describe('workflowStarts V1 execution claim', () => {
  test('allows only one caller to claim a workflow attempt', async () => {
    const t = authenticatedTest()
    await seedMembership(t)
    const workflowStart = await createWorkflowStartForTest(t)

    expect(
      await t.mutation(claimWorkflowExecution, {
        systemSecret: 'system_test',
        workflowRunId: workflowStart.workflowRun.id,
      }),
    ).toBe(true)
    expect(
      await t.mutation(claimWorkflowExecution, {
        systemSecret: 'system_test',
        workflowRunId: workflowStart.workflowRun.id,
      }),
    ).toBe(false)
    expect(
      await t.mutation(markWorkflowExecutionFailed, {
        systemSecret: 'system_test',
        workflowRunId: workflowStart.workflowRun.id,
        summary: 'Sandbox provisioning failed.',
      }),
    ).toBe(true)
    const failedRun = await t.run((ctx) =>
      ctx.db.get('workflowRuns', workflowStart.workflowRun.id),
    )
    expect(failedRun?.status).toBe('failed')
  })

  test('fails a V1 attempt closed when no source revision is pinned', async () => {
    const t = authenticatedTest()
    await seedMembership(t)
    const result = await t.mutation(createWorkflowStart, createArgs())
    if (!isWorkflowStartResult(result))
      throw new Error('Expected workflow start result')
    await t.run((ctx) =>
      ctx.db.patch('workflowRuns', result.workflowRun.id, {
        modelVersion: 'v1',
        rootWorkflowRunId: result.workflowRun.id,
        attemptNumber: 1,
        trigger: 'intake',
      }),
    )

    expect(
      await t.mutation(claimWorkflowExecution, {
        systemSecret: 'system_test',
        workflowRunId: result.workflowRun.id,
      }),
    ).toBe(false)

    const workflowRun = await t.run((ctx) =>
      ctx.db.get('workflowRuns', result.workflowRun.id),
    )
    expect(workflowRun?.status).toBe('failed')
    const provenance = await t.run((ctx) =>
      ctx.db
        .query('provenanceEvents')
        .withIndex('by_workflow_event_key', (q) =>
          q
            .eq('workflowRunId', result.workflowRun.id)
            .eq(
              'idempotencyKey',
              `${String(result.workflowRun.id)}:missing-source-revision`,
            ),
        )
        .unique(),
    )
    expect(provenance).toMatchObject({
      status: 'failed',
      errorCategory: 'setup',
    })
  })

  test('rejects external intake without a pinned source revision', async () => {
    const t = authenticatedTest()
    await expect(
      t.mutation(createWorkflowStartFromExternalIntake, {
        systemSecret: 'system_test',
        workspaceId: 'workos:org_123',
        actorId: 'github-app:123',
        actorDisplayName: 'GitHub App installation 123',
        source: 'external',
        traceId: 'trace-unpinned-external',
        prompt: 'Fix issue 7',
        externalRef: {
          provider: 'github',
          deliveryId: 'delivery-unpinned',
          eventKind: 'github.issue.opened',
        },
      }),
    ).rejects.toThrow(
      'External workflow intake requires complete valid GitHub pull request identity',
    )
  })

  test('rejects malformed external pull request identity at the Convex boundary', async () => {
    const t = authenticatedTest()
    const input = {
      systemSecret: 'system_test',
      workspaceId: 'workos:org_123',
      actorId: 'github-app:123',
      actorDisplayName: 'GitHub App installation 123',
      source: 'external' as const,
      traceId: 'trace-invalid-pr',
      prompt: 'Verify pull request 7',
      externalRef: {
        provider: 'github',
        deliveryId: 'delivery-invalid-pr',
        eventKind: 'github.pull_request.synchronize',
        repositoryProvider: 'github',
        repositoryExternalId: '456',
        repositoryOwner: 'patchplane',
        repositoryName: 'demo',
        repositoryFullName: 'patchplane/demo',
        issueExternalId: '789',
        pullRequestExternalId: '789',
        pullRequestNumber: 7,
        pullRequestUpdatedAt: 1_000,
        pullRequestBaseSha: 'not-a-sha',
        pullRequestHeadSha: '0123456789012345678901234567890123456789',
        pullRequestPreviousHeadSha: '0000000000000000000000000000000000000000',
      },
    }

    await expect(
      t.mutation(createWorkflowStartFromExternalIntake, input),
    ).rejects.toThrow(
      'External workflow intake requires complete valid GitHub pull request identity',
    )
    const rejectIdentity = async (externalRef: typeof input.externalRef) =>
      expect(
        t.mutation(createWorkflowStartFromExternalIntake, {
          ...input,
          externalRef,
        }),
      ).rejects.toThrow(
        'External workflow intake requires complete valid GitHub pull request identity',
      )

    await rejectIdentity({
      ...input.externalRef,
      deliveryId: 'delivery-invalid-pr-number',
      pullRequestNumber: 0,
      pullRequestBaseSha: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
    })
    await rejectIdentity({
      ...input.externalRef,
      deliveryId: 'delivery-incoherent-repository',
      repositoryFullName: 'other/demo',
      pullRequestBaseSha: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
    })
    await rejectIdentity({
      ...input.externalRef,
      deliveryId: 'delivery-incoherent-pr',
      issueExternalId: 'different',
      pullRequestBaseSha: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
    })
    await rejectIdentity({
      ...input.externalRef,
      deliveryId: 'delivery-unsupported-event',
      eventKind: 'github.pull_request.closed',
      pullRequestBaseSha: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
    })
  })

  test('deduplicates webhook delivery and blocks direct pre-freeze execution', async () => {
    const t = authenticatedTest()
    const intake = {
      systemSecret: 'system_test',
      workspaceId: 'workos:org_123',
      actorId: 'github-app:123',
      actorDisplayName: 'GitHub App installation 123',
      source: 'external' as const,
      traceId: 'trace-delivery-1',
      prompt: 'Fix pull request 7',
      externalRef: {
        provider: 'github',
        deliveryId: 'delivery-1',
        eventKind: 'github.pull_request.opened',
        repositoryProvider: 'github',
        repositoryInstallationId: '123',
        repositoryExternalId: '456',
        repositoryOwner: 'patchplane',
        repositoryName: 'demo',
        repositoryFullName: 'patchplane/demo',
        issueExternalId: '789',
        issueNumber: 7,
        pullRequestExternalId: '789',
        pullRequestNumber: 7,
        pullRequestUpdatedAt: 1_000,
        pullRequestBaseSha: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
        pullRequestHeadSha: '0123456789012345678901234567890123456789',
      },
    }
    const first = await t.mutation(
      createWorkflowStartFromExternalIntake,
      intake,
    )
    const replay = await t.mutation(
      createWorkflowStartFromExternalIntake,
      intake,
    )
    if (!isWorkflowStartResult(first) || !isWorkflowStartResult(replay)) {
      throw new Error('Expected workflow start result')
    }
    expect(replay.workflowRun.id).toBe(first.workflowRun.id)

    expect(
      await t.mutation(claimWorkflowExecution, {
        systemSecret: 'system_test',
        workflowRunId: first.workflowRun.id,
      }),
    ).toBe(false)
  })
})

describe('workflowStarts V1 rerun lineage', () => {
  test('creates one idempotent child attempt with explicit lineage', async () => {
    const t = authenticatedTest()
    await seedMembership(t)
    const parent = await createWorkflowStartForTest(t)
    await t.run((ctx) =>
      ctx.db.patch('workflowRuns', parent.workflowRun.id, {
        status: 'reviewed',
      }),
    )

    const first = await t.mutation(createWorkflowRerun, {
      parentWorkflowRunId: parent.workflowRun.id,
      reason: 'Gather native platform evidence.',
      idempotencyKey: 'rerun-request-1',
    })
    const replay = await t.mutation(createWorkflowRerun, {
      parentWorkflowRunId: parent.workflowRun.id,
      reason: 'Gather native platform evidence.',
      idempotencyKey: 'rerun-request-1',
    })

    expect(first).toMatchObject({
      workflowRun: {
        modelVersion: 'v1',
        parentWorkflowRunId: parent.workflowRun.id,
        rootWorkflowRunId: parent.workflowRun.id,
        attemptNumber: 2,
        trigger: 'rerun',
        sourceBaseSha: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
        sourceCommitSha: '0123456789012345678901234567890123456789',
      },
    })
    expect(replay).toMatchObject({
      workflowRun: { id: (first as WorkflowStartResult).workflowRun.id },
    })
    const parentDetail = await t.query(getWorkflowDetail, {
      workflowRunId: parent.workflowRun.id,
    })
    const childDetail = await t.query(getWorkflowDetail, {
      workflowRunId: (first as WorkflowStartResult).workflowRun.id,
    })
    expect(parentDetail).toMatchObject({
      workflowRun: { id: parent.workflowRun.id },
      newerAttempt: {
        workflowRunId: (first as WorkflowStartResult).workflowRun.id,
        attemptNumber: 2,
        status: 'queued',
      },
    })
    expect(childDetail).toMatchObject({
      workflowRun: { id: (first as WorkflowStartResult).workflowRun.id },
    })
    expect(childDetail.newerAttempt).toBeUndefined()
    const executionFixture = (await t.query(getWorkflowExecutionFixture, {
      systemSecret: 'system_test',
      workflowRunId: (first as WorkflowStartResult).workflowRun.id,
    })) as WorkflowStartResult
    expect(executionFixture.promptRequest.prompt).toContain(
      'Rerun instruction from the reviewer:\nGather native platform evidence.',
    )
    await expect(
      t.mutation(createWorkflowRerun, {
        parentWorkflowRunId: parent.workflowRun.id,
        reason: 'A different instruction.',
        idempotencyKey: 'rerun-request-1',
      }),
    ).rejects.toThrow('Rerun idempotency key conflict')
  })

  test('preserves pre-base-SHA V1 rows as explicit legacy rerun lineage', async () => {
    const t = authenticatedTest()
    await seedMembership(t)
    const legacy = await t.mutation(createWorkflowStart, createArgs())
    if (!isWorkflowStartResult(legacy)) {
      throw new Error('Expected workflow start result')
    }
    await t.run((ctx) =>
      ctx.db.patch('workflowRuns', legacy.workflowRun.id, {
        modelVersion: 'v1',
        rootWorkflowRunId: legacy.workflowRun.id,
        attemptNumber: 1,
        trigger: 'intake',
        sourceCommitSha: '0123456789012345678901234567890123456789',
        status: 'reviewed',
      }),
    )

    const child = await t.mutation(createWorkflowRerun, {
      parentWorkflowRunId: legacy.workflowRun.id,
      reason: 'Preserve historical generated-candidate lineage.',
      idempotencyKey: 'legacy-rerun-1',
    })
    expect(child).toMatchObject({
      workflowRun: {
        modelVersion: 'v1',
        parentWorkflowRunId: legacy.workflowRun.id,
        sourceCommitSha: '0123456789012345678901234567890123456789',
      },
    })
    expect(
      (child as WorkflowStartResult).workflowRun.candidateIdentityVersion,
    ).toBeUndefined()
    expect(
      (child as WorkflowStartResult).workflowRun.sourceBaseSha,
    ).toBeUndefined()
  })
})

describe('workflowStarts candidate-bound verification evidence', () => {
  test('persists a passed result only when candidate digest and required artifacts match', async () => {
    const t = authenticatedTest()
    await seedMembership(t)
    const workflowStart = await createWorkflowStartForTest(t)
    const workflowRunId = workflowStart.workflowRun.id
    await claimWorkflowForTest(t, workflowRunId)
    const sandbox = await t.mutation(recordSandboxExecution, {
      systemSecret: 'system_test',
      workflowRunId,
      provider: 'daytona',
      sandboxId: 'sandbox-1',
      command: 'pi --mode json',
      status: 'succeeded',
      exitCode: 0,
      stdout: 'done',
      startedAt: 1,
      completedAt: 2,
    })
    const diff = (await t.mutation(recordEvidenceArtifact, {
      systemSecret: 'system_test',
      workflowRunId,
      kind: 'diff',
      producer: 'sandbox:candidate:daytona:sandbox-1:1',
      subjectDigest: 'sha256:abc123',
      storageProvider: 'cloudflare-r2',
      storageKey: 'workflows/run/diff.patch',
      contentType: 'text/x-diff',
      sizeBytes: 10,
      sha256: 'abc123',
    })) as { id: Id<'evidenceArtifacts'> }
    const report = (await t.mutation(recordEvidenceArtifact, {
      systemSecret: 'system_test',
      workflowRunId,
      kind: 'test-report',
      producer: 'sandbox:test:daytona:sandbox-1:1',
      subjectDigest: 'sha256:abc123',
      storageProvider: 'cloudflare-r2',
      storageKey: 'workflows/run/test.json',
      contentType: 'application/json',
      sizeBytes: 10,
      sha256: 'def456',
    })) as { id: Id<'evidenceArtifacts'> }
    await expect(
      t.mutation(recordCandidatePatchSet, {
        systemSecret: 'system_test',
        workflowRunId,
        sandboxExecutionId: sandbox.id,
        subject: {
          kind: 'sandbox-generated',
          sandboxExecutionId: '00000000000000000002sandboxExecutions',
        },
        status: 'captured',
        candidateDigest: 'sha256:abc123',
        baseSha: '0123456789012345678901234567890123456789',
        diffArtifactId: diff.id,
        idempotencyKey: 'sandbox-1:mismatched-subject',
        createdAt: 2,
      }),
    ).rejects.toThrow(
      'Generated candidate subject must match its producing sandbox execution',
    )

    await expect(
      t.mutation(recordCandidatePatchSet, {
        systemSecret: 'system_test',
        workflowRunId,
        sandboxExecutionId: sandbox.id,
        status: 'captured',
        candidateDigest: 'sha256:abc123',
        baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        diffArtifactId: diff.id,
        idempotencyKey: 'sandbox-1:mismatched-candidate',
        createdAt: 2,
      }),
    ).rejects.toThrow(
      'Generated candidate base does not match the pinned workflow source revision',
    )

    const candidate = (await t.mutation(recordCandidatePatchSet, {
      systemSecret: 'system_test',
      workflowRunId,
      sandboxExecutionId: sandbox.id,
      status: 'captured',
      candidateDigest: 'sha256:abc123',
      baseSha: '0123456789012345678901234567890123456789',
      diffArtifactId: diff.id,
      idempotencyKey: 'sandbox-1:candidate',
      createdAt: 2,
    })) as { id: Id<'candidatePatchSets'> }
    const requirement = await t.mutation(recordVerificationRequirement, {
      systemSecret: 'system_test',
      workflowRunId,
      key: 'sandbox:test',
      label: 'Configured tests',
      kind: 'test',
      required: true,
      command: 'bun test',
      platform: 'linux',
      architecture: 'x64',
      requiredArtifactKinds: ['test-report'],
      source: 'policy',
      createdAt: 2,
    })
    const result = await t.mutation(recordVerificationResult, {
      systemSecret: 'system_test',
      workflowRunId,
      requirementId: requirement.id,
      candidatePatchSetId: candidate.id,
      sandboxExecutionId: sandbox.id,
      provider: 'daytona',
      command: 'bun test',
      platform: 'linux',
      architecture: 'x64',
      status: 'passed',
      exitCode: 0,
      artifactIds: [report.id],
      candidateDigestBefore: 'sha256:abc123',
      candidateDigestAfter: 'sha256:abc123',
      startedAt: 2,
      completedAt: 3,
      idempotencyKey: 'candidate:test:1',
    })

    expect(result).toMatchObject({
      status: 'passed',
      candidatePatchSetId: candidate.id,
    })
    const detail = await t.query(getWorkflowDetail, { workflowRunId })
    expect(detail.verificationRequirements).toHaveLength(1)
    expect(detail.verificationResults).toHaveLength(1)
    expect(detail.verificationRequirementsTruncated).toBe(false)
    expect(detail.verificationResultsTruncated).toBe(false)
  })

  test('rejects a passed result when its candidate digest changed', async () => {
    const t = authenticatedTest()
    await seedMembership(t)
    const workflowStart = await createWorkflowStartForTest(t)
    const workflowRunId = workflowStart.workflowRun.id
    const seeded = await t.run(async (ctx) => {
      const sandboxExecutionId = await ctx.db.insert('sandboxExecutions', {
        workflowRunId,
        provider: 'daytona',
        sandboxId: 'sandbox-1',
        command: 'pi',
        status: 'succeeded',
        exitCode: 0,
        stdout: 'done',
        startedAt: 1,
        completedAt: 2,
        createdAt: 2,
      })
      const candidatePatchSetId = await ctx.db.insert('candidatePatchSets', {
        workflowRunId,
        sandboxExecutionId,
        status: 'captured',
        candidateDigest: 'sha256:current',
        baseSha: 'base',
        createdAt: 2,
      })
      const requirementId = await ctx.db.insert('verificationRequirements', {
        workflowRunId,
        key: 'test',
        label: 'Tests',
        kind: 'test',
        required: true,
        requiredArtifactKinds: [],
        source: 'policy',
        createdAt: 2,
      })
      return { sandboxExecutionId, candidatePatchSetId, requirementId }
    })

    await expect(
      t.mutation(recordVerificationResult, {
        systemSecret: 'system_test',
        workflowRunId,
        requirementId: seeded.requirementId,
        candidatePatchSetId: seeded.candidatePatchSetId,
        sandboxExecutionId: seeded.sandboxExecutionId,
        provider: 'daytona',
        platform: 'linux',
        architecture: 'x64',
        status: 'passed',
        exitCode: 0,
        artifactIds: [],
        candidateDigestBefore: 'sha256:stale',
        candidateDigestAfter: 'sha256:stale',
        startedAt: 2,
        completedAt: 3,
        idempotencyKey: 'stale',
      }),
    ).rejects.toThrow('does not satisfy evidence invariants')
  })
})

describe('workflowStarts trusted boundary and authz', () => {
  test('rejects a new human decision after a child attempt supersedes the report', async () => {
    const t = authenticatedTest()
    await seedMembership(t, {
      permissions: [
        'workspace:view',
        'prompt:create',
        'run:start',
        'decision:reject',
      ],
    })
    const parent = await createWorkflowStartForTest(t)
    const records = await t.run(async (ctx) => {
      await ctx.db.patch('workflowRuns', parent.workflowRun.id, {
        status: 'reviewed',
      })
      const sandboxExecutionId = await ctx.db.insert('sandboxExecutions', {
        workflowRunId: parent.workflowRun.id,
        provider: 'daytona',
        sandboxId: 'sandbox-1',
        command: 'bun test',
        status: 'succeeded',
        stdout: 'ok',
        startedAt: 1,
        completedAt: 2,
        createdAt: 2,
      })
      const candidatePatchSetId = await ctx.db.insert('candidatePatchSets', {
        workflowRunId: parent.workflowRun.id,
        sandboxExecutionId,
        status: 'captured',
        candidateDigest: `sha256:${'a'.repeat(64)}`,
        createdAt: 3,
      })
      const reviewRunId = await ctx.db.insert('reviewRuns', {
        workflowRunId: parent.workflowRun.id,
        sandboxExecutionId,
        candidatePatchSetId,
        kind: 'test',
        reviewer: 'patchplane:test',
        status: 'completed',
        startedAt: 3,
        completedAt: 4,
        createdAt: 3,
      })
      const policyDecisionId = await ctx.db.insert('policyDecisions', {
        workflowRunId: parent.workflowRun.id,
        reviewRunId,
        candidatePatchSetId,
        status: 'approved',
        summary: 'Ready',
        policyVersion: 'alpha-v1',
        inputDigest: `sha256:${'b'.repeat(64)}`,
        createdAt: 4,
      })
      await ctx.db.insert('workflowRuns', {
        promptRequestId: parent.promptRequest.id,
        workspaceId: 'workos:org_123',
        traceId: 'trace-child',
        status: 'queued',
        modelVersion: 'v1',
        parentWorkflowRunId: parent.workflowRun.id,
        rootWorkflowRunId: parent.workflowRun.id,
        attemptNumber: 2,
        trigger: 'rerun',
        sourceBaseSha: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
        sourceCommitSha: '0123456789012345678901234567890123456789',
        createdAt: 5,
      })
      return {
        sandboxExecutionId,
        candidatePatchSetId,
        reviewRunId,
        policyDecisionId,
      }
    })

    await expect(
      t.mutation(recordHumanDecision, {
        workflowRunId: parent.workflowRun.id,
        ...records,
        status: 'rejected',
        comment: 'Reject the superseded attempt.',
        idempotencyKey: 'superseded-decision',
      }),
    ).rejects.toThrow('newer workflow attempt supersedes')
  })

  test('returns a bounded decision publication replay fixture', async () => {
    const t = authenticatedTest()
    await seedMembership(t)
    const seeded = await seedDecisionPublicationReplayFixture(t)

    const fixture = await t.query(getDecisionPublicationReplayFixture, {
      systemSecret: 'system_test',
      workflowRunId: seeded.workflowStart.workflowRun.id,
      humanDecisionId: seeded.humanDecisionId,
    })

    expect(fixture).toMatchObject({
      workflowStart: {
        promptRequest: {
          prompt: 'Ship it',
        },
        workflowRun: { id: seeded.workflowStart.workflowRun.id },
      },
      humanDecision: {
        id: seeded.humanDecisionId,
        workflowRunId: seeded.workflowStart.workflowRun.id,
        sandboxExecutionId: seeded.sandboxExecutionId,
        candidatePatchSetId: seeded.candidatePatchSetId,
        status: 'approved',
        comment: 'Evidence is sufficient.',
      },
      sandboxExecution: { id: seeded.sandboxExecutionId, status: 'succeeded' },
      candidatePatchSet: {
        id: seeded.candidatePatchSetId,
        headSha: 'head-sha',
      },
      verification: {
        status: 'not-configured',
        requiredCount: 0,
        passedCount: 0,
      },
      // A retry captured after the decision must not replace its publication target.
      candidateHeadSha: 'head-sha',
      publicationResults: [
        {
          id: seeded.issueCommentId,
          idempotencyKey: `${String(seeded.humanDecisionId)}:issue-comment`,
        },
        {
          id: seeded.checkRunId,
          idempotencyKey: `${String(seeded.humanDecisionId)}:check-run`,
        },
      ],
    })
    expect(fixture.evidenceArtifacts).toEqual([])
    expect(fixture.publicationResults).toHaveLength(2)
  })

  test('rejects stale decisions and superseded attempts from canonical publication', async () => {
    const t = authenticatedTest()
    await seedMembership(t)
    const seeded = await seedDecisionPublicationReplayFixture(t)
    const newerDecisionId = await t.run((ctx) =>
      ctx.db.insert('humanDecisions', {
        workflowRunId: seeded.workflowStart.workflowRun.id,
        sandboxExecutionId: seeded.sandboxExecutionId,
        candidatePatchSetId: seeded.candidatePatchSetId,
        actorId: 'workos:user_123',
        status: 'changes-requested',
        comment: 'Use the newer decision.',
        decidedAt: 8,
        idempotencyKey: 'newer-decision',
      }),
    )

    await expect(
      t.query(getDecisionPublicationReplayFixture, {
        systemSecret: 'system_test',
        workflowRunId: seeded.workflowStart.workflowRun.id,
        humanDecisionId: seeded.humanDecisionId,
      }),
    ).rejects.toThrow('Human decision not found')

    await t.run((ctx) =>
      ctx.db.insert('workflowRuns', {
        promptRequestId: seeded.workflowStart.promptRequest.id,
        workspaceId: 'workos:org_123',
        traceId: 'trace-child',
        status: 'queued',
        modelVersion: 'v1',
        parentWorkflowRunId: seeded.workflowStart.workflowRun.id,
        rootWorkflowRunId: seeded.workflowStart.workflowRun.id,
        attemptNumber: 2,
        trigger: 'rerun',
        createdAt: 9,
      }),
    )
    await expect(
      t.query(getDecisionPublicationReplayFixture, {
        systemSecret: 'system_test',
        workflowRunId: seeded.workflowStart.workflowRun.id,
        humanDecisionId: newerDecisionId,
      }),
    ).rejects.toThrow('latest workflow attempt')
  })

  test('rejects a replay decision belonging to another workflow', async () => {
    const t = authenticatedTest()
    await seedMembership(t)
    const seeded = await seedDecisionPublicationReplayFixture(t)
    const otherWorkflow = await createWorkflowStartForTest(t)

    await expect(
      t.query(getDecisionPublicationReplayFixture, {
        systemSecret: 'system_test',
        workflowRunId: otherWorkflow.workflowRun.id,
        humanDecisionId: seeded.humanDecisionId,
      }),
    ).rejects.toThrow('Human decision not found')
  })

  test('rejects an invalid system secret for a replay fixture', async () => {
    const t = authenticatedTest()
    await seedMembership(t)
    const seeded = await seedDecisionPublicationReplayFixture(t)

    await expect(
      t.query(getDecisionPublicationReplayFixture, {
        systemSecret: 'wrong-secret',
        workflowRunId: seeded.workflowStart.workflowRun.id,
        humanDecisionId: seeded.humanDecisionId,
      }),
    ).rejects.toThrow('System ingestion secret required')
  })

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
        eventKind: 'github.pull_request.opened',
        repositoryProvider: 'github',
        repositoryInstallationId: '123',
        repositoryExternalId: '456',
        repositoryOwner: 'patchplane',
        repositoryName: 'demo',
        repositoryFullName: 'patchplane/demo',
        issueExternalId: '789',
        issueNumber: 7,
        issueTitle: 'Fix auth callback',
        issueBody: '## Summary\n\nRepair the callback.',
        pullRequestExternalId: '789',
        pullRequestNumber: 7,
        pullRequestUpdatedAt: 1_000,
        pullRequestBaseSha: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
        pullRequestHeadSha: '0123456789012345678901234567890123456789',
        url: 'https://github.com/patchplane/demo/pull/7',
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
    expect(first.workflowRun).toMatchObject({
      modelVersion: 'v1',
      candidateIdentityVersion: 'incoming-pr-v1',
      sourceBaseSha: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
      sourceCommitSha: '0123456789012345678901234567890123456789',
    })
    expect(first.promptRequest).toMatchObject({
      workspaceId: 'workos:org_123',
      actorId: 'github-app:123',
      source: 'external',
      prompt: 'Fix auth callback',
      externalRef: {
        pullRequestBaseSha: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
        pullRequestHeadSha: '0123456789012345678901234567890123456789',
        issueTitle: 'Fix auth callback',
        issueBody: '## Summary\n\nRepair the callback.',
      },
    })

    const refs = await t.run((ctx) =>
      ctx.db.query('externalWorkflowRefs').collect(),
    )
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({
      pullRequestBaseSha: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
      pullRequestHeadSha: '0123456789012345678901234567890123456789',
      issueTitle: 'Fix auth callback',
      issueBody: '## Summary\n\nRepair the callback.',
    })
  })

  test('creates a new immutable attempt for a synchronized PR head', async () => {
    const t = authenticatedTest()
    await seedMembership(t)
    const externalRef = {
      provider: 'github',
      deliveryId: 'delivery-sync-1',
      eventKind: 'github.pull_request.synchronize',
      repositoryProvider: 'github',
      repositoryInstallationId: '123',
      repositoryExternalId: '456',
      repositoryOwner: 'patchplane',
      repositoryName: 'demo',
      repositoryFullName: 'patchplane/demo',
      issueExternalId: '789',
      issueNumber: 7,
      pullRequestExternalId: '789',
      pullRequestNumber: 7,
      pullRequestUpdatedAt: 1_000,
      pullRequestBaseSha: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
      pullRequestHeadSha: '1111111111111111111111111111111111111111',
      pullRequestPreviousHeadSha: '0000000000000000000000000000000000000000',
    }
    const input = {
      systemSecret: 'system_test',
      workspaceId: 'workos:org_123',
      actorId: 'github-app:123',
      actorDisplayName: 'GitHub App installation 123',
      source: 'external' as const,
      traceId: 'trace-sync-1',
      prompt: 'Verify pull request 7',
      externalRef,
    }

    const first = await t.mutation(createWorkflowStartFromExternalIntake, input)
    await expect(
      t.mutation(createWorkflowStartFromExternalIntake, {
        ...input,
        traceId: 'trace-sync-uppercase',
        externalRef: {
          ...externalRef,
          deliveryId: 'delivery-sync-uppercase',
          pullRequestBaseSha: externalRef.pullRequestBaseSha.toUpperCase(),
        },
      }),
    ).rejects.toThrow('complete valid GitHub pull request identity')
    const replay = await t.mutation(createWorkflowStartFromExternalIntake, {
      ...input,
      traceId: 'trace-sync-replay',
      externalRef: {
        ...externalRef,
        deliveryId: 'delivery-sync-replay',
      },
    })
    if (!isWorkflowStartResult(first) || !isWorkflowStartResult(replay)) {
      throw new Error('Expected workflow start results')
    }
    expect(replay.workflowRun.id).toBe(first.workflowRun.id)
    const unchangedPair = await t.mutation(
      createWorkflowStartFromExternalIntake,
      {
        ...input,
        traceId: 'trace-sync-unchanged-pair',
        externalRef: {
          ...externalRef,
          deliveryId: 'delivery-sync-unchanged-pair',
          pullRequestUpdatedAt: 1_500,
          pullRequestPreviousHeadSha:
            '1111111111111111111111111111111111111111',
        },
      },
    )
    if (!isWorkflowStartResult(unchangedPair)) {
      throw new Error('Expected unchanged-pair result')
    }
    expect(unchangedPair.workflowRun.id).toBe(first.workflowRun.id)

    const {
      pullRequestPreviousHeadSha: _previousHeadSha,
      ...openedExternalRef
    } = externalRef
    const delayedOpened = await t.mutation(
      createWorkflowStartFromExternalIntake,
      {
        ...input,
        traceId: 'trace-delayed-opened',
        externalRef: {
          ...openedExternalRef,
          deliveryId: 'delivery-delayed-opened',
          eventKind: 'github.pull_request.opened',
          pullRequestUpdatedAt: 500,
        },
      },
    )
    if (!isWorkflowStartResult(delayedOpened)) {
      throw new Error('Expected delayed opened result')
    }
    expect(delayedOpened.workflowRun.id).toBe(first.workflowRun.id)

    await expect(
      t.mutation(createWorkflowStartFromExternalIntake, {
        ...input,
        workspaceId: 'system:other-workspace',
        traceId: 'trace-sync-cross-workspace',
      }),
    ).rejects.toThrow('External delivery is already bound to another workspace')

    await t.run((ctx) =>
      ctx.db.insert('candidatePatchSets', {
        workflowRunId: first.workflowRun.id,
        status: 'captured',
        candidateDigest: `sha256:${'a'.repeat(64)}`,
        createdAt: 1,
      }),
    )

    const updated = await t.mutation(createWorkflowStartFromExternalIntake, {
      ...input,
      traceId: 'trace-sync-2',
      externalRef: {
        ...externalRef,
        deliveryId: 'delivery-sync-2',
        pullRequestUpdatedAt: 2_000,
        pullRequestHeadSha: '2222222222222222222222222222222222222222',
        pullRequestPreviousHeadSha: '1111111111111111111111111111111111111111',
      },
    })
    const rebased = await t.mutation(createWorkflowStartFromExternalIntake, {
      ...input,
      traceId: 'trace-sync-rebased',
      externalRef: {
        ...externalRef,
        deliveryId: 'delivery-sync-rebased',
        pullRequestUpdatedAt: 3_000,
        pullRequestBaseSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        pullRequestHeadSha: '2222222222222222222222222222222222222222',
        pullRequestPreviousHeadSha: '2222222222222222222222222222222222222222',
      },
    })
    if (!isWorkflowStartResult(updated) || !isWorkflowStartResult(rebased)) {
      throw new Error('Expected updated workflow start results')
    }

    expect(updated.workflowRun.id).not.toBe(first.workflowRun.id)
    expect(rebased.workflowRun.id).not.toBe(updated.workflowRun.id)
    expect(updated.workflowRun).toMatchObject({
      parentWorkflowRunId: first.workflowRun.id,
      rootWorkflowRunId: first.workflowRun.id,
      attemptNumber: 2,
    })
    expect(rebased.workflowRun).toMatchObject({
      parentWorkflowRunId: updated.workflowRun.id,
      rootWorkflowRunId: first.workflowRun.id,
      attemptNumber: 3,
    })
    expect(
      await t.mutation(claimWorkflowExecution, {
        systemSecret: 'system_test',
        workflowRunId: first.workflowRun.id,
      }),
    ).toBe(false)
    expect(
      await t.mutation(claimWorkflowExecution, {
        systemSecret: 'system_test',
        workflowRunId: updated.workflowRun.id,
      }),
    ).toBe(false)
    expect(first.workflowRun).toMatchObject({
      sourceBaseSha: externalRef.pullRequestBaseSha,
      sourceCommitSha: externalRef.pullRequestHeadSha,
    })
    expect(updated.workflowRun).toMatchObject({
      sourceBaseSha: externalRef.pullRequestBaseSha,
      sourceCommitSha: '2222222222222222222222222222222222222222',
    })

    const delayedReplay = await t.mutation(
      createWorkflowStartFromExternalIntake,
      {
        ...input,
        traceId: 'trace-sync-delayed-replay',
        externalRef: {
          ...externalRef,
          deliveryId: 'delivery-sync-delayed-replay',
        },
      },
    )
    if (!isWorkflowStartResult(delayedReplay)) {
      throw new Error('Expected delayed replay workflow start result')
    }
    expect(delayedReplay.workflowRun.id).toBe(first.workflowRun.id)
    expect(
      await t.mutation(claimWorkflowExecution, {
        systemSecret: 'system_test',
        workflowRunId: rebased.workflowRun.id,
      }),
    ).toBe(false)

    expect(rebased.workflowRun).toMatchObject({
      sourceBaseSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      sourceCommitSha: '2222222222222222222222222222222222222222',
    })

    await expect(
      t.mutation(createWorkflowStartFromExternalIntake, {
        ...input,
        traceId: 'trace-sync-unseen-stale',
        externalRef: {
          ...externalRef,
          deliveryId: 'delivery-sync-unseen-stale',
          pullRequestUpdatedAt: 1_500,
          pullRequestHeadSha: '1212121212121212121212121212121212121212',
          pullRequestPreviousHeadSha:
            '1111111111111111111111111111111111111111',
        },
      }),
    ).rejects.toThrow(
      'Out-of-order pull request event cannot supersede the current candidate',
    )

    const returnedPair = await t.mutation(
      createWorkflowStartFromExternalIntake,
      {
        ...input,
        traceId: 'trace-sync-returned-pair',
        externalRef: {
          ...externalRef,
          deliveryId: 'delivery-sync-returned-pair',
          pullRequestUpdatedAt: 3_500,
          pullRequestHeadSha: '2222222222222222222222222222222222222222',
          pullRequestPreviousHeadSha:
            '2222222222222222222222222222222222222222',
        },
      },
    )
    if (!isWorkflowStartResult(returnedPair)) {
      throw new Error('Expected returned-pair workflow start result')
    }
    expect(returnedPair.workflowRun).toMatchObject({
      parentWorkflowRunId: rebased.workflowRun.id,
      rootWorkflowRunId: first.workflowRun.id,
      attemptNumber: 4,
    })
    expect(returnedPair.workflowRun.id).not.toBe(updated.workflowRun.id)
    const returnedPairReplay = await t.mutation(
      createWorkflowStartFromExternalIntake,
      {
        ...input,
        traceId: 'trace-sync-returned-pair-replay',
        externalRef: {
          ...externalRef,
          deliveryId: 'delivery-sync-returned-pair-replay',
          pullRequestUpdatedAt: 3_500,
          pullRequestHeadSha: '2222222222222222222222222222222222222222',
          pullRequestPreviousHeadSha:
            '2222222222222222222222222222222222222222',
        },
      },
    )
    if (!isWorkflowStartResult(returnedPairReplay)) {
      throw new Error('Expected returned-pair replay result')
    }
    expect(returnedPairReplay.workflowRun.id).toBe(returnedPair.workflowRun.id)

    await t.run((ctx) =>
      ctx.db.patch('workflowRuns', returnedPair.workflowRun.id, {
        status: 'reviewed',
      }),
    )
    const rerun = await t.mutation(createWorkflowRerun, {
      parentWorkflowRunId: returnedPair.workflowRun.id,
      reason: 'Recheck the current candidate.',
      idempotencyKey: 'sync-lineage-rerun-1',
    })
    if (!isWorkflowStartResult(rerun)) {
      throw new Error('Expected rerun workflow start result')
    }
    const afterRerun = await t.mutation(createWorkflowStartFromExternalIntake, {
      ...input,
      traceId: 'trace-sync-after-rerun',
      externalRef: {
        ...externalRef,
        deliveryId: 'delivery-sync-after-rerun',
        pullRequestUpdatedAt: 3_500,
        pullRequestBaseSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        pullRequestHeadSha: '3333333333333333333333333333333333333333',
        pullRequestPreviousHeadSha: '2222222222222222222222222222222222222222',
      },
    })
    if (!isWorkflowStartResult(afterRerun)) {
      throw new Error('Expected post-rerun synchronize result')
    }
    expect(afterRerun.workflowRun).toMatchObject({
      parentWorkflowRunId: rerun.workflowRun.id,
      rootWorkflowRunId: first.workflowRun.id,
      attemptNumber: 6,
    })
    await expect(
      t.mutation(createWorkflowRerun, {
        parentWorkflowRunId: returnedPair.workflowRun.id,
        reason: 'Do not rerun a superseded candidate.',
        idempotencyKey: 'sync-lineage-stale-rerun',
      }),
    ).rejects.toThrow('A newer workflow attempt supersedes this rerun parent')

    const candidateRows = await t.run((ctx) =>
      ctx.db
        .query('candidatePatchSets')
        .withIndex('by_workflow_run', (q) =>
          q.eq('workflowRunId', updated.workflowRun.id),
        )
        .collect(),
    )
    expect(candidateRows).toEqual([])
    const updatedDetail = await t.query(getWorkflowDetail, {
      workflowRunId: updated.workflowRun.id,
    })
    expect(updatedDetail.candidatePatchSets).toEqual([])
  })

  test('persists a frozen incoming PR candidate without a sandbox producer', async () => {
    vi.useFakeTimers()
    const t = authenticatedTest()
    await seedMembership(t)
    const baseSha = 'abcdefabcdefabcdefabcdefabcdefabcdefabcd'
    const headSha = '0123456789012345678901234567890123456789'
    const externalRef = {
      provider: 'github',
      deliveryId: 'delivery-freeze-1',
      eventKind: 'github.pull_request.opened',
      repositoryProvider: 'github',
      repositoryInstallationId: '123',
      repositoryExternalId: '456',
      repositoryOwner: 'patchplane',
      repositoryName: 'demo',
      repositoryFullName: 'patchplane/demo',
      issueExternalId: '789',
      pullRequestExternalId: '789',
      pullRequestNumber: 7,
      pullRequestUpdatedAt: 1_000,
      pullRequestBaseSha: baseSha,
      pullRequestHeadSha: headSha,
    }
    const started = await t.mutation(createWorkflowStartFromExternalIntake, {
      systemSecret: 'system_test',
      workspaceId: 'workos:org_123',
      actorId: 'github-app:123',
      actorDisplayName: 'GitHub App installation 123',
      source: 'external',
      traceId: 'trace-freeze-1',
      prompt: 'Verify pull request 7',
      externalRef,
    })
    if (!isWorkflowStartResult(started)) {
      throw new Error('Expected workflow start result')
    }
    const firstLeaseToken = 'freeze-lease-token-00000001'
    const activeLeaseToken = 'freeze-lease-token-00000002'
    expect(
      await t.mutation(claimCandidateFreeze, {
        systemSecret: 'system_test',
        workflowRunId: started.workflowRun.id,
        leaseToken: firstLeaseToken,
      }),
    ).toBe(false)
    const planSources = [
      { kind: 'deployment-system' as const, revision: 'system-v1' },
    ]
    const planRequirements = [
      {
        key: 'sandbox:test',
        label: 'Configured test verification',
        kind: 'test' as const,
        required: true,
        command: 'bun test',
        platform: 'linux' as const,
        timeoutSeconds: 300,
        requiredArtifactKinds: ['test-report' as const],
      },
    ]
    const planDigestBytes = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(
        canonicalJson({
          requirements: planRequirements,
          sources: planSources,
          version: 'verification-plan-v1',
        }),
      ),
    )
    const planDigest = `sha256:${Array.from(
      new Uint8Array(planDigestBytes),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('')}`
    const plan = await t.mutation(recordVerificationPlan, {
      systemSecret: 'system_test',
      workflowRunId: started.workflowRun.id,
      version: 'verification-plan-v1',
      sources: planSources,
      requirements: planRequirements,
      digest: planDigest,
      createdAt: 1,
    })
    expect(plan.workflowRunId).toBe(started.workflowRun.id)
    const requirementArgs = {
      systemSecret: 'system_test',
      workflowRunId: started.workflowRun.id,
      verificationPlanId: plan.id,
      ...planRequirements[0],
      source: 'policy' as const,
      createdAt: 1,
    }
    const requirement = await t.mutation(
      recordVerificationRequirement,
      requirementArgs,
    )
    const requirementReplay = await t.mutation(recordVerificationRequirement, {
      ...requirementArgs,
      createdAt: 99,
    })
    expect(requirementReplay.id).toBe(requirement.id)
    expect(requirementReplay.createdAt).toBe(1)
    expect(
      await t.mutation(claimCandidateFreeze, {
        systemSecret: 'system_test',
        workflowRunId: started.workflowRun.id,
        leaseToken: firstLeaseToken,
      }),
    ).toBe(true)
    expect(
      await t.mutation(claimCandidateFreeze, {
        systemSecret: 'system_test',
        workflowRunId: started.workflowRun.id,
        leaseToken: activeLeaseToken,
      }),
    ).toBe(false)
    await t.run((ctx) =>
      ctx.db.patch('workflowRuns', started.workflowRun.id, {
        candidateFreezeClaimedAt: Date.now() - 300_001,
      }),
    )
    expect(
      await t.mutation(claimCandidateFreeze, {
        systemSecret: 'system_test',
        workflowRunId: started.workflowRun.id,
        leaseToken: activeLeaseToken,
      }),
    ).toBe(true)
    expect(
      await t.mutation(releaseCandidateFreeze, {
        systemSecret: 'system_test',
        workflowRunId: started.workflowRun.id,
        leaseToken: firstLeaseToken,
      }),
    ).toBe(false)

    const digest = `sha256:${'d'.repeat(64)}`
    const producer = `source-control:github:compare:456:${baseSha}...${headSha}`
    const artifactArgs = {
      systemSecret: 'system_test',
      workflowRunId: started.workflowRun.id,
      producer,
      subjectDigest: digest,
      kind: 'diff' as const,
      storageProvider: 'cloudflare-r2' as const,
      storageKey: 'workflows/freeze/incoming.diff',
      contentType: 'application/vnd.github.v3.diff',
      sizeBytes: 10,
      sha256: 'd'.repeat(64),
      createdAt: 2,
    }
    const artifact = await t.mutation(recordEvidenceArtifact, artifactArgs)
    const artifactReplay = await t.mutation(recordEvidenceArtifact, {
      ...artifactArgs,
      createdAt: 99,
    })
    expect(artifactReplay.id).toBe(artifact.id)
    const candidateArgs = {
      systemSecret: 'system_test',
      workflowRunId: started.workflowRun.id,
      candidateFreezeLeaseToken: activeLeaseToken,
      subject: {
        kind: 'incoming-pull-request' as const,
        repositoryProvider: 'github' as const,
        repositoryExternalId: '456',
        repositoryOwner: 'patchplane',
        repositoryName: 'demo',
        repositoryFullName: 'patchplane/demo',
        pullRequestExternalId: '789',
        pullRequestNumber: 7,
        baseSha,
        headSha,
        sourceEventProvider: 'github' as const,
        sourceEventDeliveryId: 'delivery-freeze-1',
        sourceEventKind: 'github.pull_request.opened' as const,
      },
      status: 'captured' as const,
      candidateDigest: digest,
      baseSha,
      headSha,
      diffArtifactId: artifact.id,
      summary: 'Frozen exact incoming PR candidate.',
      idempotencyKey: `${started.workflowRun.id}:incoming-pr:${baseSha}:${headSha}`,
      createdAt: 3,
    }
    await expect(
      t.mutation(recordCandidatePatchSet, {
        ...candidateArgs,
        candidateFreezeLeaseToken: firstLeaseToken,
      }),
    ).rejects.toThrow(
      'Current incoming-PR attempt requires its subject and active freeze lease',
    )
    const candidate = await t.mutation(recordCandidatePatchSet, candidateArgs)
    const replayedPlan = await t.mutation(recordVerificationPlan, {
      systemSecret: 'system_test',
      workflowRunId: started.workflowRun.id,
      version: 'verification-plan-v1',
      sources: planSources,
      requirements: planRequirements,
      digest: planDigest,
      createdAt: 99,
    })
    expect(replayedPlan.id).toBe(plan.id)
    expect(replayedPlan.createdAt).toBe(1)

    expect(candidate).toMatchObject({
      workflowRunId: started.workflowRun.id,
      status: 'captured',
      candidateDigest: digest,
      baseSha,
      headSha,
      subject: { kind: 'incoming-pull-request' },
    })
    expect(candidate.sandboxExecutionId).toBeUndefined()
    expect(
      await t.query(getCandidatePatchSetForWorkflow, {
        systemSecret: 'system_test',
        workflowRunId: started.workflowRun.id,
      }),
    ).toMatchObject({ id: candidate.id, candidateDigest: digest })
    const dispatchToken = 'dispatch-token-0000000000001'
    expect(
      await t.mutation(claimIncomingDispatch, {
        systemSecret: 'system_test',
        workflowRunId: started.workflowRun.id,
        candidatePatchSetId: candidate.id,
        dispatchToken,
      }),
    ).toBe(true)
    expect(
      await t.mutation(validateIncomingDispatch, {
        systemSecret: 'system_test',
        workflowRunId: started.workflowRun.id,
        candidatePatchSetId: candidate.id,
        dispatchToken,
      }),
    ).toBe(true)
    await t.run((ctx) =>
      ctx.db.patch('workflowRuns', started.workflowRun.id, {
        incomingDispatchClaimedAt: Date.now() - 300_001,
      }),
    )
    const resumedDispatchToken = 'dispatch-token-0000000000002'
    expect(
      await t.mutation(claimIncomingDispatch, {
        systemSecret: 'system_test',
        workflowRunId: started.workflowRun.id,
        candidatePatchSetId: candidate.id,
        dispatchToken: resumedDispatchToken,
      }),
    ).toBe(true)
    expect(
      await t.mutation(validateIncomingDispatch, {
        systemSecret: 'system_test',
        workflowRunId: started.workflowRun.id,
        candidatePatchSetId: candidate.id,
        dispatchToken,
      }),
    ).toBe(false)
    expect(
      await t.mutation(validateIncomingDispatch, {
        systemSecret: 'system_test',
        workflowRunId: started.workflowRun.id,
        candidatePatchSetId: candidate.id,
        dispatchToken: resumedDispatchToken,
      }),
    ).toBe(true)
    expect(
      await t.mutation(startIncomingDispatch, {
        systemSecret: 'system_test',
        workflowRunId: started.workflowRun.id,
        candidatePatchSetId: candidate.id,
        dispatchToken: resumedDispatchToken,
        sandboxId: 'sandbox-dispatch-started',
      }),
    ).toBe(true)
    await expect(
      t.mutation(recordSandboxExecution, {
        systemSecret: 'system_test',
        workflowRunId: started.workflowRun.id,
        incomingDispatchToken: resumedDispatchToken,
        provider: 'daytona',
        sandboxId: 'sandbox-different-from-started-dispatch',
        command: 'verify',
        status: 'succeeded',
        exitCode: 0,
        stdout: 'must be rejected',
        startedAt: 10,
        completedAt: 11,
      }),
    ).rejects.toThrow(
      'Incoming PR sandbox execution requires its active started dispatch',
    )
    expect(
      await t.mutation(markWorkflowExecutionFailed, {
        systemSecret: 'system_test',
        workflowRunId: started.workflowRun.id,
        incomingDispatchToken: dispatchToken,
        summary: 'Stale worker must not fail the replacement dispatch.',
      }),
    ).toBe(false)
    await t.run((ctx) =>
      ctx.db.patch('workflowRuns', started.workflowRun.id, {
        incomingDispatchClaimedAt: Date.now() - 300_001,
      }),
    )
    expect(
      await t.mutation(claimIncomingDispatch, {
        systemSecret: 'system_test',
        workflowRunId: started.workflowRun.id,
        candidatePatchSetId: candidate.id,
        dispatchToken: 'dispatch-token-third-generation-123456',
      }),
    ).toBe(false)
    expect(
      await t.mutation(validateIncomingDispatch, {
        systemSecret: 'system_test',
        workflowRunId: started.workflowRun.id,
        candidatePatchSetId: candidate.id,
        dispatchToken: resumedDispatchToken,
      }),
    ).toBe(true)
    expect(
      await t.mutation(claimWorkflowExecution, {
        systemSecret: 'system_test',
        workflowRunId: started.workflowRun.id,
      }),
    ).toBe(false)
    await t.mutation(recordSandboxExecution, {
      systemSecret: 'system_test',
      workflowRunId: started.workflowRun.id,
      incomingDispatchToken: resumedDispatchToken,
      provider: 'daytona',
      sandboxId: 'sandbox-dispatch-started',
      command: 'verify',
      status: 'succeeded',
      exitCode: 0,
      stdout: 'durable execution before simulated continuation crash',
      startedAt: 12,
      completedAt: 13,
    })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    const recovered = await t.run((ctx) =>
      ctx.db.get('workflowRuns', started.workflowRun.id),
    )
    expect(recovered?.status).toBe('failed')
    vi.useRealTimers()
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
      t.mutation(
        createWorkflowStart,
        createArgs({ workspaceId: 'workos:org_456' }),
      ),
    ).rejects.toThrow('Workspace mismatch')

    await expect(
      t.mutation(
        createWorkflowStart,
        createArgs({ actorId: 'workos:user_456' }),
      ),
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
    expect(result.workflowRun.modelVersion).toBeUndefined()
    expect(result.workflowRun.sourceCommitSha).toBeUndefined()
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

    await claimWorkflowForTest(t, workflowStart.workflowRun.id)
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

    const rows = await t.run((ctx) =>
      ctx.db.query('sandboxExecutions').collect(),
    )
    expect(rows[0]?.policy).toEqual(policy)
  })

  test('getDetail returns workflow context, runtime events, and sandbox executions', async () => {
    const t = authenticatedTest()
    await seedMembership(t)
    const workflowStart = await createWorkflowStartForTest(t)

    await claimWorkflowForTest(t, workflowStart.workflowRun.id)
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
      workflowRun: { id: workflowStart.workflowRun.id, status: 'running' },
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
      sha256:
        '2689367b205c16ce32e8ecd5e2fe58ae6d4acc7ba32d3d116dc92d4c2715f1b5',
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
      sha256:
        '2689367b205c16ce32e8ecd5e2fe58ae6d4acc7ba32d3d116dc92d4c2715f1b5',
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

  test('records candidate patch, review, policy, human decision, and publication data for workflow detail', async () => {
    const t = authenticatedTest()
    await seedMembership(t, {
      role: 'admin',
      roles: ['admin'],
      permissions: [
        'workspace:view',
        'prompt:create',
        'run:start',
        'decision:approve',
        'decision:reject',
      ],
    })
    const workflowStart = await createWorkflowStartForTest(t)

    await claimWorkflowForTest(t, workflowStart.workflowRun.id)
    const sandboxExecution = await t.mutation(recordSandboxExecution, {
      systemSecret: 'system_test',
      workflowRunId: workflowStart.workflowRun.id,
      provider: 'daytona',
      sandboxId: 'sandbox-1',
      command: 'bun test',
      status: 'failed',
      exitCode: 1,
      stdout: 'failed',
      startedAt: 9,
      completedAt: 10,
    })

    const diffArtifact = await t.mutation(recordEvidenceArtifact, {
      systemSecret: 'system_test',
      workflowRunId: workflowStart.workflowRun.id,
      kind: 'diff',
      label: 'Candidate patch diff',
      producer: 'sandbox:candidate:daytona:sandbox-1:9',
      subjectDigest:
        'sha256:e6ff7f597b8273fcf32be7311134f8ae97f0652a4fcac0d8049144a2b682e3d7',
      storageProvider: 'cloudflare-r2',
      storageKey: 'workflow-1/diff.patch',
      contentType: 'text/x-diff',
      sizeBytes: 42,
      sha256:
        'e6ff7f597b8273fcf32be7311134f8ae97f0652a4fcac0d8049144a2b682e3d7',
      createdAt: 10,
    })

    const patchSet = await t.mutation(recordCandidatePatchSet, {
      systemSecret: 'system_test',
      workflowRunId: workflowStart.workflowRun.id,
      sandboxExecutionId: sandboxExecution.id,
      status: 'captured',
      candidateDigest:
        'sha256:e6ff7f597b8273fcf32be7311134f8ae97f0652a4fcac0d8049144a2b682e3d7',
      baseRef: 'main',
      baseSha: '0123456789012345678901234567890123456789',
      diffArtifactId: diffArtifact.id,
      summary: 'Updates the auth callback.',
      stats: { filesChanged: 2, additions: 10, deletions: 3 },
      idempotencyKey: 'sandbox-execution-1:candidate',
      createdAt: 11,
    })

    const reviewRun = await t.mutation(recordReviewRun, {
      systemSecret: 'system_test',
      workflowRunId: workflowStart.workflowRun.id,
      sandboxExecutionId: sandboxExecution.id,
      candidatePatchSetId: patchSet.id,
      kind: 'test',
      reviewer: 'patchplane:test-reviewer',
      status: 'completed',
      summary: 'One failing test',
      startedAt: 12,
      completedAt: 13,
      idempotencyKey: 'review-1',
      createdAt: 12,
    })

    const finding = await t.mutation(recordReviewFinding, {
      systemSecret: 'system_test',
      workflowRunId: workflowStart.workflowRun.id,
      reviewRunId: reviewRun.id,
      severity: 'error',
      category: 'test',
      message: 'Unit test failed',
      path: 'src/auth.test.ts',
      startLine: 17,
      endLine: 17,
      evidenceArtifactId: diffArtifact.id,
      idempotencyKey: 'review-1:finding:0',
      createdAt: 13,
    })

    const policyDecision = await t.mutation(recordPolicyDecision, {
      systemSecret: 'system_test',
      workflowRunId: workflowStart.workflowRun.id,
      reviewRunId: reviewRun.id,
      candidatePatchSetId: patchSet.id,
      status: 'changes-requested',
      summary: 'Tests must pass before approval.',
      policyVersion: 'alpha-v1',
      inputDigest: `sha256:${'a'.repeat(64)}`,
      verificationResultIds: [],
      reviewFindingIds: [finding.id],
      missingRequirementIds: [],
      reason: 'review-finding:error',
      idempotencyKey: 'review-1:policy:alpha-v1',
      createdAt: 14,
    })

    const humanDecision = await t.mutation(recordHumanDecision, {
      workflowRunId: workflowStart.workflowRun.id,
      sandboxExecutionId: sandboxExecution.id,
      candidatePatchSetId: patchSet.id,
      reviewRunId: reviewRun.id,
      policyDecisionId: policyDecision.id,
      status: 'changes-requested',
      comment: 'Please fix the failing auth test first.',
      idempotencyKey: 'decision-attempt-1',
    })
    const replayedHumanDecision = await t.mutation(recordHumanDecision, {
      workflowRunId: workflowStart.workflowRun.id,
      sandboxExecutionId: sandboxExecution.id,
      candidatePatchSetId: patchSet.id,
      reviewRunId: reviewRun.id,
      policyDecisionId: policyDecision.id,
      status: 'changes-requested',
      comment: 'Please fix the failing auth test first.',
      idempotencyKey: 'decision-attempt-1',
    })

    await t.mutation(recordPublicationResult, {
      systemSecret: 'system_test',
      workflowRunId: workflowStart.workflowRun.id,
      humanDecisionId: humanDecision.id,
      candidatePatchSetId: patchSet.id,
      provider: 'github',
      kind: 'issue-comment',
      status: 'pending',
      dispatchToken: 'publication-dispatch-1',
      idempotencyKey: `${String(humanDecision.id)}:issue-comment`,
      createdAt: 15,
    })
    const publication = await t.mutation(recordPublicationResult, {
      systemSecret: 'system_test',
      workflowRunId: workflowStart.workflowRun.id,
      humanDecisionId: humanDecision.id,
      candidatePatchSetId: patchSet.id,
      provider: 'github',
      kind: 'issue-comment',
      status: 'published',
      externalId: '12345',
      url: 'https://github.com/patchplane/demo/issues/12#issuecomment-12345',
      summary: 'Published PatchPlane decision comment.',
      dispatchToken: 'publication-dispatch-1',
      idempotencyKey: `${String(humanDecision.id)}:issue-comment`,
      createdAt: 16,
    })

    expect(patchSet).toMatchObject({
      diffArtifactId: diffArtifact.id,
      status: 'captured',
    })
    expect(finding).toMatchObject({
      reviewRunId: reviewRun.id,
      evidenceArtifactId: diffArtifact.id,
    })
    expect(policyDecision).toMatchObject({ status: 'changes-requested' })
    expect(humanDecision).toMatchObject({
      sandboxExecutionId: sandboxExecution.id,
      candidatePatchSetId: patchSet.id,
      reviewRunId: reviewRun.id,
      policyDecisionId: policyDecision.id,
      actorId: 'workos:user_123',
      comment: 'Please fix the failing auth test first.',
      idempotencyKey: 'decision-attempt-1',
    })
    expect(replayedHumanDecision.id).toBe(humanDecision.id)
    expect(publication).toMatchObject({
      provider: 'github',
      kind: 'issue-comment',
    })

    const detail = await t.query(getWorkflowDetail, {
      workflowRunId: workflowStart.workflowRun.id,
    })
    expect(detail.candidatePatchSets?.[0]).toMatchObject({
      id: patchSet.id,
      diffArtifactId: diffArtifact.id,
    })
    expect(detail.reviewRuns?.[0]).toMatchObject({
      id: reviewRun.id,
      status: 'completed',
    })
    expect(detail.reviewFindings?.[0]).toMatchObject({
      id: finding.id,
      severity: 'error',
    })
    expect(detail.policyDecisions?.[0]).toMatchObject({ id: policyDecision.id })
    expect(detail.humanDecisions).toHaveLength(1)
    expect(detail.humanDecisions?.[0]).toMatchObject({ id: humanDecision.id })
    expect(detail.publicationResults?.[0]).toMatchObject({ id: publication.id })

    const snapshot = await t.query(getTrustLoopAcceptanceSnapshot, {
      systemSecret: 'system_test',
      workflowRunId: workflowStart.workflowRun.id,
    })
    expect(snapshot).toMatchObject({
      workflowRunId: workflowStart.workflowRun.id,
      hasRuntimeEvents: false,
      hasRuntimeSessions: false,
      sandboxExecutionStatuses: ['failed'],
      latestSandboxExecution: {
        id: sandboxExecution.id,
        status: 'failed',
        completedAt: 10,
      },
      evidenceArtifacts: [
        {
          id: diffArtifact.id,
          kind: 'diff',
          storageKey: 'workflow-1/diff.patch',
          sizeBytes: 42,
          sha256:
            'e6ff7f597b8273fcf32be7311134f8ae97f0652a4fcac0d8049144a2b682e3d7',
          createdAt: 10,
        },
      ],
      candidatePatchStatuses: ['captured'],
      latestCandidatePatchSet: {
        id: patchSet.id,
        status: 'captured',
        diffArtifactId: diffArtifact.id,
        createdAt: 11,
      },
      reviewRunStatuses: ['completed'],
      latestReviewRun: {
        id: reviewRun.id,
        sandboxExecutionId: sandboxExecution.id,
        candidatePatchSetId: patchSet.id,
        status: 'completed',
        createdAt: 12,
      },
      policyDecisionStatuses: ['changes-requested'],
      latestPolicyDecision: {
        status: 'changes-requested',
        reviewRunId: reviewRun.id,
        createdAt: 14,
      },
      humanDecisions: [
        {
          id: humanDecision.id,
          status: 'changes-requested',
          idempotencyKey: 'decision-attempt-1',
        },
      ],
      publicationResults: [
        {
          kind: 'issue-comment',
          status: 'published',
          externalId: '12345',
          idempotencyKey: `${String(humanDecision.id)}:issue-comment`,
        },
      ],
      hasProvenanceEvents: true,
    })

    await t.run((ctx) =>
      ctx.db.insert('candidatePatchSets', {
        workflowRunId: workflowStart.workflowRun.id,
        sandboxExecutionId: sandboxExecution.id,
        status: 'captured',
        candidateDigest:
          'sha256:e6ff7f597b8273fcf32be7311134f8ae97f0652a4fcac0d8049144a2b682e3d7',
        baseSha: 'abc123',
        diffArtifactId: diffArtifact.id as Id<'evidenceArtifacts'>,
        idempotencyKey: 'newer-test-fixture',
        createdAt: 20,
      }),
    )
    await expect(
      t.mutation(recordHumanDecision, {
        workflowRunId: workflowStart.workflowRun.id,
        sandboxExecutionId: sandboxExecution.id,
        candidatePatchSetId: patchSet.id,
        reviewRunId: reviewRun.id,
        policyDecisionId: policyDecision.id,
        status: 'changes-requested',
        comment: 'Please fix the failing auth test first.',
        idempotencyKey: 'decision-attempt-1',
      }),
    ).rejects.toThrow('Displayed review projection is stale')

    await expect(
      t.mutation(recordHumanDecision, {
        workflowRunId: workflowStart.workflowRun.id,
        sandboxExecutionId: sandboxExecution.id,
        candidatePatchSetId: patchSet.id,
        reviewRunId: reviewRun.id,
        policyDecisionId: policyDecision.id,
        status: 'approved',
        comment: 'Approve the projection I previously saw.',
        idempotencyKey: 'decision-attempt-stale',
      }),
    ).rejects.toThrow('Displayed review projection is stale')

    await t.run((ctx) =>
      ctx.db.patch('workflowRuns', workflowStart.workflowRun.id, {
        status: 'failed',
      }),
    )
    await expect(
      t.mutation(recordPolicyDecision, {
        systemSecret: 'system_test',
        workflowRunId: workflowStart.workflowRun.id,
        status: 'changes-requested',
        summary: 'A timed-out continuation must stay failed.',
        idempotencyKey: 'late-policy-after-timeout',
      }),
    ).rejects.toThrow('Failed workflow attempts cannot record policy decisions')

    await expect(
      t.query(getTrustLoopAcceptanceSnapshot, {
        systemSecret: 'wrong-secret',
        workflowRunId: workflowStart.workflowRun.id,
      }),
    ).rejects.toThrow('System ingestion secret required')
  })

  test('records an explicit human override when approval proceeds with incomplete verification', async () => {
    const t = authenticatedTest()
    await seedMembership(t, {
      permissions: [
        'workspace:view',
        'prompt:create',
        'run:start',
        'decision:approve',
      ],
    })
    const workflowStart = await createWorkflowStartForTest(t)
    const records = await t.run(async (ctx) => {
      await ctx.db.patch('workflowRuns', workflowStart.workflowRun.id, {
        status: 'reviewed',
      })
      const sandboxExecutionId = await ctx.db.insert('sandboxExecutions', {
        workflowRunId: workflowStart.workflowRun.id,
        provider: 'daytona',
        sandboxId: 'sandbox-override',
        command: 'pi',
        status: 'succeeded',
        exitCode: 0,
        stdout: 'done',
        startedAt: 1,
        completedAt: 2,
        createdAt: 2,
      })
      const diffArtifactId = await ctx.db.insert('evidenceArtifacts', {
        workflowRunId: workflowStart.workflowRun.id,
        kind: 'diff',
        storageProvider: 'cloudflare-r2',
        storageKey: 'override/diff.patch',
        contentType: 'text/x-diff',
        sizeBytes: 1,
        sha256: 'override',
        createdAt: 2,
      })
      const candidatePatchSetId = await ctx.db.insert('candidatePatchSets', {
        workflowRunId: workflowStart.workflowRun.id,
        sandboxExecutionId,
        status: 'captured',
        candidateDigest: 'sha256:override',
        baseSha: 'base',
        diffArtifactId,
        idempotencyKey: 'override-candidate',
        createdAt: 2,
      })
      const reviewRunId = await ctx.db.insert('reviewRuns', {
        workflowRunId: workflowStart.workflowRun.id,
        sandboxExecutionId,
        candidatePatchSetId,
        kind: 'test',
        reviewer: 'patchplane:alpha-reviewer',
        status: 'completed',
        startedAt: 2,
        completedAt: 3,
        createdAt: 3,
      })
      const policyDecisionId = await ctx.db.insert('policyDecisions', {
        workflowRunId: workflowStart.workflowRun.id,
        reviewRunId,
        candidatePatchSetId,
        status: 'manual-review',
        summary: 'Verification incomplete.',
        policyVersion: 'alpha-v1',
        verificationResultIds: [],
        missingRequirementIds: [],
        createdAt: 4,
      })
      return {
        sandboxExecutionId,
        candidatePatchSetId,
        reviewRunId,
        policyDecisionId,
      }
    })

    const input = {
      workflowRunId: workflowStart.workflowRun.id,
      ...records,
      status: 'approved' as const,
      comment: 'I reviewed the unsupported platform risk.',
      idempotencyKey: 'override-decision',
    }
    await expect(t.mutation(recordHumanDecision, input)).rejects.toThrow(
      'requires an explicit override reason',
    )
    const decision = await t.mutation(recordHumanDecision, {
      ...input,
      verificationOverrideReason:
        'Native macOS evidence is unavailable; manual review accepted the residual risk.',
    })

    expect(decision).toMatchObject({
      status: 'approved',
      verificationOverride: true,
      verificationOverrideReason:
        'Native macOS evidence is unavailable; manual review accepted the residual risk.',
    })
  })

  test('human decisions require a non-empty comment and matching decision permission', async () => {
    const t = authenticatedTest()
    await seedMembership(t, {
      permissions: [
        'workspace:view',
        'prompt:create',
        'run:start',
        'decision:approve',
      ],
    })
    const workflowStart = await createWorkflowStartForTest(t)

    await expect(
      t.mutation(recordHumanDecision, {
        workflowRunId: workflowStart.workflowRun.id,
        status: 'approved',
        comment: '   ',
      }),
    ).rejects.toThrow('Decision comment required')

    await expect(
      t.mutation(recordHumanDecision, {
        workflowRunId: workflowStart.workflowRun.id,
        status: 'rejected',
        comment: 'This is not safe enough.',
      }),
    ).rejects.toThrow('Permission required')

    await expect(
      t.mutation(recordHumanDecision, {
        workflowRunId: workflowStart.workflowRun.id,
        status: 'approved',
        comment: 'Evidence looks good.',
      }),
    ).rejects.toThrow('Displayed review projection IDs required')
  })

  test('review findings reject review runs and artifacts from a different workflow', async () => {
    const t = authenticatedTest()
    await seedMembership(t)
    const firstWorkflow = await createWorkflowStartForTest(t)
    const secondWorkflow = await createWorkflowStartForTest(t)

    const reviewRun = await t.mutation(recordReviewRun, {
      systemSecret: 'system_test',
      workflowRunId: firstWorkflow.workflowRun.id,
      kind: 'test',
      reviewer: 'patchplane:test-reviewer',
      status: 'completed',
      startedAt: 1,
      completedAt: 2,
      idempotencyKey: 'cross-workflow-review',
      createdAt: 1,
    })
    const artifact = await t.mutation(recordEvidenceArtifact, {
      systemSecret: 'system_test',
      workflowRunId: firstWorkflow.workflowRun.id,
      kind: 'test-report',
      storageProvider: 'cloudflare-r2',
      storageKey: 'workflow-1/test-report.json',
      contentType: 'application/json',
      sizeBytes: 2,
      sha256:
        '2689367b205c16ce32e8ecd5e2fe58ae6d4acc7ba32d3d116dc92d4c2715f1b5',
      createdAt: 3,
    })

    await expect(
      t.mutation(recordReviewFinding, {
        systemSecret: 'system_test',
        workflowRunId: secondWorkflow.workflowRun.id,
        reviewRunId: reviewRun.id,
        severity: 'error',
        category: 'test',
        message: 'Wrong workflow review run',
        idempotencyKey: 'wrong-review-run',
      }),
    ).rejects.toThrow('Review run not found')

    await expect(
      t.mutation(recordReviewFinding, {
        systemSecret: 'system_test',
        workflowRunId: secondWorkflow.workflowRun.id,
        severity: 'error',
        category: 'test',
        message: 'Wrong workflow artifact',
        evidenceArtifactId: artifact.id,
        idempotencyKey: 'wrong-artifact',
      }),
    ).rejects.toThrow('Evidence artifact not found')
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

  test('getDetail bounds runtime event payloads while raw evidence remains external', async () => {
    const t = authenticatedTest()
    await seedMembership(t)
    const workflowStart = await createWorkflowStartForTest(t)

    await t.mutation(recordRuntimeEvents, {
      systemSecret: 'system_test',
      events: Array.from({ length: 102 }, (_, index) => ({
        workflowRunId: workflowStart.workflowRun.id,
        provider: 'pi',
        type: `pi.message_update.${index}`,
        occurredAt: index,
        payloadJson: JSON.stringify({ index, partial: 'x'.repeat(9_000) }),
      })),
    })

    const detail = await t.query(getWorkflowDetail, {
      workflowRunId: workflowStart.workflowRun.id,
    })

    expect(detail.runtimeEvents).toHaveLength(100)
    expect(detail.runtimeEventsTruncated).toBe(true)
    expect(detail.runtimeEvents[0]?.type).toBe('pi.message_update.2')
    expect(detail.runtimeEvents.at(-1)?.type).toBe('pi.message_update.101')
    expect(detail.runtimeEvents[0]?.payloadJson).toContain(
      'truncated; full runtime output remains in the workflow evidence artifact',
    )
    expect(detail.runtimeEvents[0]?.payloadJson?.length).toBeLessThan(8_200)
  })

  test('getDetail bounds sandbox executions and inline command output', async () => {
    const t = authenticatedTest()
    await seedMembership(t)
    const workflowStart = await createWorkflowStartForTest(t)
    const secret = 'do-not-send-to-the-browser'

    await t.run(async (ctx) => {
      await Promise.all(
        Array.from({ length: 34 }, (_, index) =>
          ctx.db.insert('sandboxExecutions', {
            workflowRunId: workflowStart.workflowRun.id,
            provider: 'daytona',
            sandboxId: `sandbox-${index}`,
            command:
              index === 2
                ? `TOKEN=${secret} --api-key=${secret} --password '${secret}' Authorization: Bearer ${secret} pi --model 'gpt-5.5' ${'z'.repeat(1_200)}`
                : 'bun test',
            status: 'succeeded',
            exitCode: 0,
            stdout: `stdout-${index}-${'x'.repeat(20_000)}`,
            stderr: `stderr-${index}-${'y'.repeat(20_000)}`,
            startedAt: index,
            completedAt: index + 1,
            createdAt: index + 1,
          }),
        ),
      )
    })

    const detail = await t.query(getWorkflowDetail, {
      workflowRunId: workflowStart.workflowRun.id,
    })

    expect(detail.sandboxExecutions).toHaveLength(32)
    expect(detail.sandboxExecutionsTruncated).toBe(true)
    expect(detail.sandboxExecutions[0]?.sandboxId).toBe('sandbox-2')
    expect(detail.sandboxExecutions.at(-1)?.sandboxId).toBe('sandbox-33')
    expect(detail.sandboxExecutions[0]?.command).not.toContain(secret)
    expect(detail.sandboxExecutions[0]?.command).toContain('[redacted]')
    expect(detail.sandboxExecutions[0]?.command.endsWith('…')).toBe(true)
    expect(detail.sandboxExecutions[0]?.command).toHaveLength(1_001)
    expect(detail.sandboxExecutions[0]?.runtimeModel).toBe('gpt-5.5')
    expect(detail.sandboxExecutions[0]?.stdout).toContain(
      'truncated; full sandbox output remains in the workflow evidence artifact',
    )
    expect(detail.sandboxExecutions[0]?.stdout.length).toBeLessThan(16_200)
    expect(detail.sandboxExecutions[0]?.stderr?.length).toBeLessThan(16_200)
  })

  test('recordPublicationResult updates failed retry rows without stale errors', async () => {
    const t = authenticatedTest()
    await seedMembership(t)
    const workflowStart = await createWorkflowStartForTest(t)
    const publicationSubject = await t.run(async (ctx) => {
      const candidatePatchSetId = await ctx.db.insert('candidatePatchSets', {
        workflowRunId: workflowStart.workflowRun.id,
        status: 'captured',
        candidateDigest: 'sha256:publication',
        baseSha: 'base',
        headSha: 'candidate-head-sha',
        idempotencyKey: 'publication-candidate',
        createdAt: 10,
      })
      const humanDecisionId = await ctx.db.insert('humanDecisions', {
        workflowRunId: workflowStart.workflowRun.id,
        candidatePatchSetId,
        actorId: 'workos:user_123',
        status: 'approved',
        comment: 'Publish.',
        decidedAt: 11,
      })
      return { candidatePatchSetId, humanDecisionId }
    })
    const idempotencyKey = `${workflowStart.workflowRun.id}:decision:reviewer:approved:key:check-run`

    const firstClaim = await t.mutation(recordPublicationResult, {
      systemSecret: 'system_test',
      workflowRunId: workflowStart.workflowRun.id,
      humanDecisionId: publicationSubject.humanDecisionId,
      candidatePatchSetId: publicationSubject.candidatePatchSetId,
      targetSha: 'candidate-head-sha',
      provider: 'github',
      kind: 'check-run',
      status: 'pending',
      dispatchToken: 'dispatcher-1',
      createdAt: 18,
      idempotencyKey,
    })
    const competingClaim = await t.mutation(recordPublicationResult, {
      systemSecret: 'system_test',
      workflowRunId: workflowStart.workflowRun.id,
      humanDecisionId: publicationSubject.humanDecisionId,
      candidatePatchSetId: publicationSubject.candidatePatchSetId,
      targetSha: 'candidate-head-sha',
      provider: 'github',
      kind: 'check-run',
      status: 'pending',
      dispatchToken: 'dispatcher-2',
      createdAt: 19,
      idempotencyKey,
    })
    expect(competingClaim).toMatchObject({
      id: firstClaim.id,
      dispatchToken: 'dispatcher-1',
    })

    const failed = await t.mutation(recordPublicationResult, {
      systemSecret: 'system_test',
      workflowRunId: workflowStart.workflowRun.id,
      humanDecisionId: publicationSubject.humanDecisionId,
      candidatePatchSetId: publicationSubject.candidatePatchSetId,
      targetSha: 'candidate-head-sha',
      provider: 'github',
      kind: 'check-run',
      status: 'failed',
      summary: 'Published approval check.',
      error: 'GitHub timeout',
      dispatchToken: 'dispatcher-1',
      createdAt: 20,
      idempotencyKey,
    })
    const retryClaim = await t.mutation(recordPublicationResult, {
      systemSecret: 'system_test',
      workflowRunId: workflowStart.workflowRun.id,
      humanDecisionId: publicationSubject.humanDecisionId,
      candidatePatchSetId: publicationSubject.candidatePatchSetId,
      targetSha: 'candidate-head-sha',
      provider: 'github',
      kind: 'check-run',
      status: 'pending',
      dispatchToken: 'dispatcher-2',
      createdAt: 21,
      idempotencyKey,
    })
    expect(retryClaim.dispatchToken).toBe('dispatcher-2')
    const published = await t.mutation(recordPublicationResult, {
      systemSecret: 'system_test',
      workflowRunId: workflowStart.workflowRun.id,
      humanDecisionId: publicationSubject.humanDecisionId,
      candidatePatchSetId: publicationSubject.candidatePatchSetId,
      targetSha: 'candidate-head-sha',
      provider: 'github',
      kind: 'check-run',
      status: 'published',
      externalId: 'check-1',
      url: 'https://github.test/check/1',
      summary: 'Published approval check.',
      dispatchToken: 'dispatcher-2',
      createdAt: 22,
      idempotencyKey,
    })

    expect(published.id).toBe(failed.id)
    expect(published).toMatchObject({
      status: 'published',
      externalId: 'check-1',
      url: 'https://github.test/check/1',
    })
    expect(published).not.toHaveProperty('error')

    const detail = await t.query(getWorkflowDetail, {
      workflowRunId: workflowStart.workflowRun.id,
    })
    expect(detail.publicationResults).toHaveLength(1)
    expect(detail.publicationResults?.[0]).toMatchObject({
      id: failed.id,
      status: 'published',
      externalId: 'check-1',
    })
    expect(detail.publicationResults?.[0]).not.toHaveProperty('error')
  })

  test('recordProvenanceEvent updates aggregate retry status and artifact links', async () => {
    const t = authenticatedTest()
    await seedMembership(t)
    const workflowStart = await createWorkflowStartForTest(t)
    const common = {
      systemSecret: 'system_test',
      workflowRunId: workflowStart.workflowRun.id,
      traceId: 'trace-1',
      type: 'publication',
      operation: 'publishDecisionToSource',
      startedAt: 20,
      completedAt: 21,
      idempotencyKey: 'decision-1:publication',
    }

    const failed = await t.mutation(recordProvenanceEvent, {
      ...common,
      status: 'failed',
      summary: 'Published 1/2 decision publication targets.',
      artifactRefs: ['decision-1', 'publication-1'],
    })
    const succeeded = await t.mutation(recordProvenanceEvent, {
      ...common,
      status: 'succeeded',
      completedAt: 22,
      summary: 'Published 2/2 decision publication targets.',
      artifactRefs: ['decision-1', 'publication-1', 'publication-2'],
    })

    expect(succeeded.id).toBe(failed.id)
    expect(succeeded).toMatchObject({
      status: 'succeeded',
      completedAt: 22,
      artifactRefs: ['decision-1', 'publication-1', 'publication-2'],
    })

    const detail = await t.query(getWorkflowDetail, {
      workflowRunId: workflowStart.workflowRun.id,
    })
    expect(
      detail.provenanceEvents?.filter(
        (event) => event.idempotencyKey === common.idempotencyKey,
      ),
    ).toEqual([
      expect.objectContaining({
        status: 'succeeded',
        summary: 'Published 2/2 decision publication targets.',
      }),
    ])
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

    await expect(
      t.query(getActiveRuntimeSession, {
        systemSecret: 'system_test',
        workflowRunId: workflowStart.workflowRun.id,
      }),
    ).resolves.toMatchObject({
      sandboxId: 'sandbox-1',
      sessionId: 'session-1',
      commandId: 'cmd-1',
      status: 'running',
    })

    const runtimeSessionId =
      typeof started === 'object' && started !== null && 'id' in started
        ? started.id
        : undefined
    expect(runtimeSessionId).toBeDefined()

    await t.mutation(markRuntimeSessionStatus, {
      systemSecret: 'system_test',
      runtimeSessionId,
      status: 'cancelled',
      completedAt: 20,
    })

    await expect(
      t.query(getActiveRuntimeSession, {
        systemSecret: 'system_test',
        workflowRunId: workflowStart.workflowRun.id,
      }),
    ).resolves.toBeNull()
  })

  test('authorizeRuntimeControl requires run interrupt permission for workflow workspace', async () => {
    const t = authenticatedTest()
    await seedMembership(t, {
      permissions: ['workspace:view', 'prompt:create', 'run:interrupt'],
    })
    const workflowStart = await createWorkflowStartForTest(t)

    await expect(
      t.query(authorizeRuntimeControl, {
        workflowRunId: workflowStart.workflowRun.id,
      }),
    ).resolves.toMatchObject({
      workflowRunId: workflowStart.workflowRun.id,
      workspaceId: 'workos:org_123',
      allowed: true,
    })

    const missingPermission = authenticatedTest()
    await seedMembership(missingPermission, {
      permissions: ['workspace:view', 'prompt:create'],
    })
    const otherWorkflowStart =
      await createWorkflowStartForTest(missingPermission)
    await expect(
      missingPermission.query(authorizeRuntimeControl, {
        workflowRunId: otherWorkflowStart.workflowRun.id,
      }),
    ).rejects.toThrow('Permission required')
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
    const workflowStart = await createWorkflowStartForTest(t)
    const workflowRun = await t.run((ctx) =>
      ctx.db.get('workflowRuns', workflowStart.workflowRun.id),
    )
    if (workflowRun === null) throw new Error('Workflow run was not created')
    const executionCompletedAt = workflowRun.createdAt + 60_000
    await t.run((ctx) =>
      ctx.db.insert('sandboxExecutions', {
        workflowRunId: workflowStart.workflowRun.id,
        provider: 'daytona',
        sandboxId: 'sandbox-list-freshness',
        command: 'bun test',
        status: 'succeeded',
        exitCode: 0,
        stdout: 'passed',
        startedAt: executionCompletedAt - 1_000,
        completedAt: executionCompletedAt,
        createdAt: executionCompletedAt,
      }),
    )

    await expect(
      convexTest(schema, modules).query(listRecentWorkflowStarts, {
        workspaceId: 'workos:org_123',
      }),
    ).rejects.toThrow('Authentication required')

    await expect(
      t.query(listRecentWorkflowStarts, { workspaceId: 'workos:org_456' }),
    ).rejects.toThrow('Workspace mismatch')

    const recent = (await t.query(listRecentWorkflowStarts, {
      workspaceId: 'workos:org_123',
    })) as Array<{ workflowRun: { updatedAt?: number } }>
    expect(recent).toHaveLength(1)
    expect(recent[0]?.workflowRun.updatedAt).toBe(executionCompletedAt)
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
