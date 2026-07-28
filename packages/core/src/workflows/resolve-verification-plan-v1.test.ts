import { Effect } from 'effect'
import { NodeCrypto } from '@effect/platform-node'
import { describe, expect, it } from 'vitest'
import { makeWorkflowRunId, makeWorkspaceId } from '@patchplane/domain/ids'
import { makeGitCommitSha } from '@patchplane/domain/refinements'
import { ResolveVerificationPlanV1 } from './resolve-verification-plan-v1'

const requirement = (key: string, command: string) => ({
  key,
  label: key,
  kind: 'test' as const,
  required: true,
  command,
  platform: 'linux' as const,
  timeoutSeconds: 300,
  requiredArtifactKinds: ['test-report' as const],
})

describe('ResolveVerificationPlanV1', () => {
  it('keeps system requirements non-negotiable and applies workspace before repository precedence', async () => {
    const plan = await Effect.runPromise(
      ResolveVerificationPlanV1({
        workflowRunId: makeWorkflowRunId('run_plan'),
        system: {
          source: { kind: 'deployment-system', revision: 'system-v1' },
          requirements: [requirement('test', 'bun test')],
        },
        workspace: {
          source: {
            kind: 'workspace-policy',
            workspaceId: makeWorkspaceId('workos:org_123'),
            revision: 'workspace-v2',
          },
          requirements: [
            requirement('test', 'attacker override'),
            requirement('lint', 'bun lint'),
          ],
        },
        baseRepository: {
          source: {
            kind: 'base-repository-policy',
            repositoryFullName: 'octo/demo',
            baseSha: makeGitCommitSha('a'.repeat(40)),
            revision: 'base:abc123',
          },
          requirements: [
            requirement('lint', 'weaker lint'),
            requirement('build', 'bun build'),
          ],
        },
        createdAt: 1,
      }).pipe(Effect.provide(NodeCrypto.layer)),
    )

    expect(
      plan.requirements.map(({ key, command }) => ({ key, command })),
    ).toEqual([
      { key: 'test', command: 'bun test' },
      { key: 'lint', command: 'bun lint' },
      { key: 'build', command: 'bun build' },
    ])
    expect(plan.digest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(plan.sources.map((source) => source.kind)).toEqual([
      'deployment-system',
      'workspace-policy',
      'base-repository-policy',
    ])
  })

  it('rejects duplicates within a source and plans over the bounded maximum', async () => {
    await expect(
      Effect.runPromise(
        ResolveVerificationPlanV1({
          workflowRunId: makeWorkflowRunId('run_duplicate'),
          system: {
            source: { kind: 'deployment-system', revision: 'system-v1' },
            requirements: [
              requirement('same', 'one'),
              requirement('same', 'two'),
            ],
          },
          createdAt: 1,
        }).pipe(Effect.provide(NodeCrypto.layer)),
      ),
    ).rejects.toThrow('Trusted verification plan is invalid')

    await expect(
      Effect.runPromise(
        ResolveVerificationPlanV1({
          workflowRunId: makeWorkflowRunId('run_too_many'),
          system: {
            source: { kind: 'deployment-system', revision: 'system-v1' },
            requirements: Array.from({ length: 17 }, (_, index) =>
              requirement(`test-${index}`, 'bun test'),
            ),
          },
          createdAt: 1,
        }).pipe(Effect.provide(NodeCrypto.layer)),
      ),
    ).rejects.toThrow('exceeds pre-decode limits')
  })
})
