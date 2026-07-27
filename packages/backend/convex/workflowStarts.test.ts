/// <reference types="vite/client" />
import { makeFunctionReference } from 'convex/server'
import type { Id } from './_generated/dataModel'
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
    id: Id<'promptRequests'>
    workspaceId: string
    actorId: string
    source: string
    prompt: string
  }
  workflowRun: {
    id: Id<'workflowRuns'>
    modelVersion?: 'v1' | undefined
    sourceCommitSha?: string | undefined
  }
}

interface WorkflowDetailResult {
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
  { systemSecret: string; workflowRunId: string; summary: string },
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

const recordCandidatePatchSet = makeFunctionReference<
  'mutation',
  Record<string, unknown>,
  Record<string, unknown>
>('workflowStarts:recordCandidatePatchSet')

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
      'External workflow intake requires a pinned source commit SHA',
    )
  })

  test('deduplicates webhook delivery and permits exactly one sandbox execution', async () => {
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
    ).toBe(true)
    expect(
      await t.mutation(claimWorkflowExecution, {
        systemSecret: 'system_test',
        workflowRunId: replay.workflowRun.id,
      }),
    ).toBe(false)

    await t.mutation(recordSandboxExecution, {
      systemSecret: 'system_test',
      workflowRunId: first.workflowRun.id,
      provider: 'daytona',
      sandboxId: 'sandbox-delivery-1',
      command: 'pi --mode json',
      status: 'succeeded',
      exitCode: 0,
      stdout: 'done',
      startedAt: 1,
      completedAt: 2,
    })
    await expect(
      t.mutation(recordSandboxExecution, {
        systemSecret: 'system_test',
        workflowRunId: first.workflowRun.id,
        provider: 'daytona',
        sandboxId: 'sandbox-delivery-duplicate',
        command: 'pi --mode json',
        status: 'succeeded',
        exitCode: 0,
        stdout: 'duplicate',
        startedAt: 1,
        completedAt: 2,
      }),
    ).rejects.toThrow('V1 workflow attempt already has a sandbox execution')

    const executions = await t.run((ctx) =>
      ctx.db
        .query('sandboxExecutions')
        .withIndex('by_workflow_run', (q) =>
          q.eq('workflowRunId', first.workflowRun.id),
        )
        .take(2),
    )
    expect(executions).toHaveLength(1)
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
      },
    })
    expect(replay).toMatchObject({
      workflowRun: { id: (first as WorkflowStartResult).workflowRun.id },
    })
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
        status: 'captured',
        candidateDigest: 'sha256:abc123',
        baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        diffArtifactId: diff.id,
        idempotencyKey: 'sandbox-1:mismatched-candidate',
        createdAt: 2,
      }),
    ).rejects.toThrow(
      'Candidate base commit does not match the pinned workflow source revision',
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
        pullRequestExternalId: '789',
        pullRequestNumber: 7,
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
      sourceCommitSha: '0123456789012345678901234567890123456789',
    })
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
