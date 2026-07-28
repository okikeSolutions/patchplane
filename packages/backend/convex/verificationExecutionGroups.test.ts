/// <reference types="vite/client" />
import { makeFunctionReference } from 'convex/server'
import type { Id } from './_generated/dataModel'
import { convexTest } from 'convex-test'
import { describe, expect, test, vi } from 'vitest'
import schema from './schema'

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])
const startPlan = makeFunctionReference<
  'mutation',
  Record<string, unknown>,
  boolean
>('workflowStarts:startIncomingVerificationPlan')
const claimGroup = makeFunctionReference<
  'mutation',
  Record<string, unknown>,
  (Record<string, unknown> & { id: Id<'verificationExecutionGroups'> }) | null
>('workflowStarts:claimVerificationExecutionGroup')
const startGroup = makeFunctionReference<
  'mutation',
  Record<string, unknown>,
  boolean
>('workflowStarts:startVerificationExecutionGroup')
const recordSandbox = makeFunctionReference<
  'mutation',
  Record<string, unknown>,
  Record<string, unknown> & { id: Id<'sandboxExecutions'> }
>('workflowStarts:recordSandboxExecution')
const getExecutionState = makeFunctionReference<
  'query',
  Record<string, unknown>,
  Record<string, unknown>
>('workflowStarts:getVerificationExecutionState')
const recordResult = makeFunctionReference<
  'mutation',
  Record<string, unknown>,
  Record<string, unknown> & { id: Id<'verificationResults'> }
>('workflowStarts:recordVerificationResult')

async function seedIncomingExecutionGroupFixture(
  t: ReturnType<typeof convexTest>,
) {
  const baseSha = 'a'.repeat(40)
  const headSha = 'b'.repeat(40)
  const digest = `sha256:${'c'.repeat(64)}`
  return t.run(async (ctx) => {
    const promptRequestId = await ctx.db.insert('promptRequests', {
      workspaceId: 'system:test',
      actorId: 'system:test',
      actorDisplayName: 'System',
      source: 'external',
      prompt: 'verify',
      status: 'created',
      createdAt: 1,
    })
    const workflowRunId = await ctx.db.insert('workflowRuns', {
      promptRequestId,
      workspaceId: 'system:test',
      traceId: 'trace-execution-group',
      modelVersion: 'v1',
      attemptNumber: 1,
      trigger: 'intake',
      candidateIdentityVersion: 'incoming-pr-v1',
      sourceBaseSha: baseSha,
      sourceCommitSha: headSha,
      status: 'running',
      createdAt: 1,
    })
    const planId = await ctx.db.insert('verificationPlans', {
      workflowRunId,
      version: 'verification-plan-v1',
      sources: [{ kind: 'deployment-system', revision: 'policy-1' }],
      requirements: [
        {
          key: 'trusted:test',
          label: 'Trusted test',
          kind: 'test',
          required: true,
          command: 'bun test',
          platform: 'linux',
          architecture: 'x86_64',
          timeoutSeconds: 60,
          requiredArtifactKinds: [],
        },
      ],
      digest: `sha256:${'d'.repeat(64)}`,
      createdAt: 1,
    })
    const requirementId = await ctx.db.insert('verificationRequirements', {
      workflowRunId,
      verificationPlanId: planId,
      key: 'trusted:test',
      label: 'Trusted test',
      kind: 'test',
      required: true,
      command: 'bun test',
      platform: 'linux',
      architecture: 'x86_64',
      timeoutSeconds: 60,
      requiredArtifactKinds: [],
      source: 'policy',
      createdAt: 1,
    })
    const diffArtifactId = await ctx.db.insert('evidenceArtifacts', {
      workflowRunId,
      producer: 'source-control:github:compare',
      subjectDigest: digest,
      kind: 'diff',
      storageProvider: 'cloudflare-r2',
      storageKey: 'candidate.diff',
      contentType: 'text/x-diff',
      sizeBytes: 1,
      sha256: 'c'.repeat(64),
      createdAt: 1,
    })
    const candidatePatchSetId = await ctx.db.insert('candidatePatchSets', {
      workflowRunId,
      subject: {
        kind: 'incoming-pull-request',
        repositoryProvider: 'github',
        repositoryExternalId: '1',
        repositoryOwner: 'patchplane',
        repositoryName: 'demo',
        repositoryFullName: 'patchplane/demo',
        pullRequestExternalId: '2',
        pullRequestNumber: 2,
        baseSha,
        headSha,
        sourceEventProvider: 'github',
        sourceEventDeliveryId: 'delivery-1',
        sourceEventKind: 'github.pull_request.opened',
      },
      status: 'captured',
      candidateDigest: digest,
      baseSha,
      headSha,
      diffArtifactId,
      createdAt: 1,
    })
    const incomingDispatchToken = 'dispatch-token-fixture-000000000001'
    const commandDigest = `sha256:${Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode('bun test'),
        ),
      ),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('')}`
    await ctx.db.patch('workflowRuns', workflowRunId, {
      incomingDispatchToken,
      incomingDispatchCandidatePatchSetId: candidatePatchSetId,
      incomingDispatchClaimedAt: Date.now(),
    })
    return {
      workflowRunId,
      planId,
      requirementId,
      candidatePatchSetId,
      digest,
      incomingDispatchToken,
      commandDigest,
    }
  })
}

describe('trusted verification execution groups', () => {
  test('materializes missing terminal groups when a plan crashes before claims', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const fixture = await seedIncomingExecutionGroupFixture(t)
    expect(
      await t.mutation(startPlan, {
        systemSecret: 'system_test',
        workflowRunId: fixture.workflowRunId,
        verificationPlanId: fixture.planId,
        candidatePatchSetId: fixture.candidatePatchSetId,
        incomingDispatchToken: fixture.incomingDispatchToken,
      }),
    ).toBe(true)
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    const state = await t.query(getExecutionState, {
      systemSecret: 'system_test',
      workflowRunId: fixture.workflowRunId,
      verificationPlanId: fixture.planId,
      candidatePatchSetId: fixture.candidatePatchSetId,
    })
    expect(state).toMatchObject({
      groups: [{ requirementId: fixture.requirementId, status: 'failed' }],
      results: [
        {
          requirementId: fixture.requirementId,
          status: 'error',
          cleanupStatus: 'failed',
        },
      ],
    })
    vi.useRealTimers()
  })

  test('recovers a started group that never persists a terminal result', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const fixture = await seedIncomingExecutionGroupFixture(t)
    expect(
      await t.mutation(startPlan, {
        systemSecret: 'system_test',
        workflowRunId: fixture.workflowRunId,
        verificationPlanId: fixture.planId,
        candidatePatchSetId: fixture.candidatePatchSetId,
        incomingDispatchToken: fixture.incomingDispatchToken,
      }),
    ).toBe(true)
    const claimToken = 'claim-token-recovery-000000000001'
    const group = await t.mutation(claimGroup, {
      systemSecret: 'system_test',
      workflowRunId: fixture.workflowRunId,
      verificationPlanId: fixture.planId,
      requirementId: fixture.requirementId,
      candidatePatchSetId: fixture.candidatePatchSetId,
      stableKey: `${fixture.planId}:${fixture.requirementId}:${fixture.candidatePatchSetId}`,
      claimToken,
      incomingDispatchToken: fixture.incomingDispatchToken,
      provider: 'daytona',
      platform: 'linux',
      architecture: 'x86_64',
      commandDigest: fixture.commandDigest,
      timeoutSeconds: 60,
      claimedAt: Date.now(),
    })
    if (group === null) throw new Error('Expected claimed group')
    expect(
      await t.mutation(startGroup, {
        systemSecret: 'system_test',
        workflowRunId: fixture.workflowRunId,
        executionGroupId: group.id,
        claimToken,
        sandboxId: 'sandbox-recovery-1',
      }),
    ).toBe(true)
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    const recovered = await t.run((ctx) =>
      ctx.db.get('verificationExecutionGroups', group.id),
    )
    expect(recovered?.status).toBe('failed')
    const recoveredResults = await t.run((ctx) =>
      ctx.db
        .query('verificationResults')
        .withIndex('by_workflow_run', (q) =>
          q.eq('workflowRunId', fixture.workflowRunId),
        )
        .collect(),
    )
    expect(recoveredResults).toEqual([
      expect.objectContaining({
        executionGroupId: group.id,
        status: 'error',
        cleanupStatus: 'failed',
        stdoutCaptureStatus: 'failed',
        stderrCaptureStatus: 'failed',
      }),
    ])
    const provenance = await t.run((ctx) =>
      ctx.db
        .query('provenanceEvents')
        .withIndex('by_workflow_run', (q) =>
          q.eq('workflowRunId', fixture.workflowRunId),
        )
        .collect(),
    )
    expect(provenance).toContainEqual(
      expect.objectContaining({
        operation: 'workflowStarts.expireIncomingVerificationDispatch',
        errorCategory: 'verification-plan-recovery-timeout',
      }),
    )
    vi.useRealTimers()
  })

  test('fences duplicate groups and accepts only a complete candidate-bound envelope', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedIncomingExecutionGroupFixture(t)
    expect(
      await t.mutation(startPlan, {
        systemSecret: 'system_test',
        workflowRunId: fixture.workflowRunId,
        verificationPlanId: fixture.planId,
        candidatePatchSetId: fixture.candidatePatchSetId,
        incomingDispatchToken: fixture.incomingDispatchToken,
      }),
    ).toBe(true)
    const claimToken = 'claim-token-000000000000000001'
    const stableKey = `${fixture.planId}:${fixture.requirementId}:${fixture.candidatePatchSetId}`
    const group = await t.mutation(claimGroup, {
      systemSecret: 'system_test',
      workflowRunId: fixture.workflowRunId,
      verificationPlanId: fixture.planId,
      requirementId: fixture.requirementId,
      candidatePatchSetId: fixture.candidatePatchSetId,
      stableKey,
      claimToken,
      incomingDispatchToken: fixture.incomingDispatchToken,
      provider: 'daytona',
      platform: 'linux',
      architecture: 'x86_64',
      commandDigest: fixture.commandDigest,
      timeoutSeconds: 60,
      claimedAt: 10,
    })
    expect(group).toMatchObject({ status: 'claimed', sharedState: false })
    expect(
      await t.mutation(claimGroup, {
        systemSecret: 'system_test',
        workflowRunId: fixture.workflowRunId,
        verificationPlanId: fixture.planId,
        requirementId: fixture.requirementId,
        candidatePatchSetId: fixture.candidatePatchSetId,
        stableKey,
        claimToken: 'claim-token-duplicate-00000000002',
        incomingDispatchToken: fixture.incomingDispatchToken,
        provider: 'daytona',
        platform: 'linux',
        architecture: 'x86_64',
        commandDigest: fixture.commandDigest,
        timeoutSeconds: 60,
        claimedAt: 11,
      }),
    ).toBeNull()
    if (group === null) throw new Error('Expected claimed group')
    const startedAt = Date.now()
    const completedAt = startedAt + 8
    expect(
      await t.mutation(startGroup, {
        systemSecret: 'system_test',
        workflowRunId: fixture.workflowRunId,
        executionGroupId: group.id,
        claimToken,
        sandboxId: 'sandbox-fresh-1',
      }),
    ).toBe(true)
    const sandbox = await t.mutation(recordSandbox, {
      systemSecret: 'system_test',
      workflowRunId: fixture.workflowRunId,
      executionGroupId: group.id,
      executionGroupClaimToken: claimToken,
      idempotencyKey: `${group.id}:sandbox-execution`,
      provider: 'daytona',
      sandboxId: 'sandbox-fresh-1',
      command: 'bun test',
      status: 'succeeded',
      exitCode: 0,
      stdout: 'passed',
      stderr: '',
      policy: {
        lifecycle: { ephemeral: true, retainAfterRun: false },
        network: {},
        resources: {},
        timeoutSeconds: 60,
      },
      startedAt,
      completedAt,
    })
    const sandboxReplay = await t.mutation(recordSandbox, {
      systemSecret: 'system_test',
      workflowRunId: fixture.workflowRunId,
      executionGroupId: group.id,
      executionGroupClaimToken: claimToken,
      idempotencyKey: `${group.id}:sandbox-execution`,
      provider: 'daytona',
      sandboxId: 'sandbox-fresh-1',
      command: 'bun test',
      status: 'succeeded',
      exitCode: 0,
      stdout: 'passed',
      stderr: '',
      policy: {
        lifecycle: { ephemeral: true, retainAfterRun: false },
        network: {},
        resources: {},
        timeoutSeconds: 60,
      },
      startedAt,
      completedAt,
    })
    expect(sandboxReplay.id).toBe(sandbox.id)
    const producer = `sandbox:test:daytona:sandbox-fresh-1:${startedAt}`
    const [stdoutArtifactId, stderrArtifactId] = await t.run(async (ctx) =>
      Promise.all(
        (['stdout', 'stderr'] as const).map((kind) =>
          ctx.db.insert('evidenceArtifacts', {
            workflowRunId: fixture.workflowRunId,
            producer,
            subjectDigest: fixture.digest,
            kind,
            storageProvider: 'cloudflare-r2',
            storageKey: `${kind}.txt`,
            contentType: 'text/plain',
            sizeBytes: 1,
            sha256: kind === 'stdout' ? 'e'.repeat(64) : 'f'.repeat(64),
            createdAt: completedAt,
          }),
        ),
      ),
    )
    const resultArgs = {
      systemSecret: 'system_test',
      workflowRunId: fixture.workflowRunId,
      verificationPlanId: fixture.planId,
      executionGroupId: group.id,
      executionGroupClaimToken: claimToken,
      requirementId: fixture.requirementId,
      candidatePatchSetId: fixture.candidatePatchSetId,
      sandboxExecutionId: sandbox.id,
      provider: 'daytona',
      command: 'bun test',
      commandDigest: fixture.commandDigest,
      platform: 'linux' as const,
      architecture: 'x86_64',
      status: 'passed' as const,
      exitCode: 0,
      artifactIds: [stdoutArtifactId, stderrArtifactId],
      stdoutArtifactId,
      stderrArtifactId,
      stdoutCaptureStatus: 'captured' as const,
      stderrCaptureStatus: 'captured' as const,
      cleanupStatus: 'deleted' as const,
      candidateDigestBefore: fixture.digest,
      candidateDigestAfter: fixture.digest,
      startedAt,
      completedAt,
      idempotencyKey: `${group.id}:result`,
    }
    await expect(
      t.mutation(recordResult, {
        ...resultArgs,
        executionGroupClaimToken: 'wrong-token-00000000000000000',
      }),
    ).rejects.toThrow('Verification execution group does not match result')
    const result = await t.mutation(recordResult, resultArgs)
    const resultReplay = await t.mutation(recordResult, resultArgs)
    expect(resultReplay.id).toBe(result.id)
    expect(result).toMatchObject({
      verificationPlanId: fixture.planId,
      executionGroupId: group.id,
      status: 'passed',
      cleanupStatus: 'deleted',
      producedArtifactKinds: ['stdout', 'stderr'],
    })
    const state = await t.query(getExecutionState, {
      systemSecret: 'system_test',
      workflowRunId: fixture.workflowRunId,
      verificationPlanId: fixture.planId,
      candidatePatchSetId: fixture.candidatePatchSetId,
    })
    expect(state).toMatchObject({
      groups: [{ id: group.id, status: 'completed' }],
      results: [{ id: result.id, executionGroupId: group.id }],
      sandboxExecutions: [{ id: sandbox.id, executionGroupId: group.id }],
    })
    const persistedGroup = await t.run((ctx) =>
      ctx.db.get('verificationExecutionGroups', group.id),
    )
    expect(persistedGroup).toMatchObject({
      status: 'completed',
      sandboxExecutionId: sandbox.id,
      completedAt,
    })
  })
})
