import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { StorageError } from '@patchplane/domain/errors'
import type { EvidenceArtifact } from '@patchplane/domain/evidence-artifact'
import type { SandboxExecution } from '@patchplane/domain/sandbox-execution'
import { AlphaPolicyServiceLayer, AlphaReviewServiceLayer } from '../services/alpha-review-policy'
import { StorageService } from '../services/storage-service'
import { ProposeMergeDecision } from './propose-merge-decision'

const sandboxExecution: SandboxExecution = {
  id: 'execution-1',
  workflowRunId: 'workflow-1' as never,
  provider: 'daytona',
  sandboxId: 'sandbox-1',
  command: 'bun test',
  status: 'failed',
  exitCode: 1,
  stdout: 'failed',
  stderr: 'expected true to be false',
  startedAt: 10,
  completedAt: 20,
}

const diffArtifact: EvidenceArtifact = {
  id: 'artifact-1',
  workflowRunId: 'workflow-1' as never,
  kind: 'diff',
  label: 'Candidate patch diff',
  storageProvider: 'cloudflare-r2',
  storageKey: 'workflow-1/diff.patch',
  contentType: 'text/x-diff',
  sizeBytes: 42,
  sha256: 'sha',
  createdAt: 21,
}

describe('ProposeMergeDecision', () => {
  it.effect('records review findings and a conservative policy decision', () =>
    Effect.gen(function* () {
      const recorded: Array<{ readonly type: string; readonly value: unknown }> = []
      const storageLayer = Layer.succeed(StorageService, StorageService.of({
        createWorkflowFromIntake: () => Effect.fail(new StorageError({ operation: 'unused', message: 'unused', cause: undefined })),
        createWorkflowFromPrompt: () => Effect.fail(new StorageError({ operation: 'unused', message: 'unused', cause: undefined })),
        listRecentWorkflowStarts: () => Effect.succeed([]),
        recordSandboxExecution: () => Effect.fail(new StorageError({ operation: 'unused', message: 'unused', cause: undefined })),
        recordRuntimeEvents: () => Effect.succeed([]),
        recordRuntimeSessionStarted: () => Effect.fail(new StorageError({ operation: 'unused', message: 'unused', cause: undefined })),
        markRuntimeSessionStatus: () => Effect.fail(new StorageError({ operation: 'unused', message: 'unused', cause: undefined })),
        getActiveRuntimeSession: () => Effect.die('unused'),
        recordEvidenceArtifact: () => Effect.fail(new StorageError({ operation: 'unused', message: 'unused', cause: undefined })),
        getEvidenceArtifact: () => Effect.die('unused'),
        recordCandidatePatchSet: (input) => Effect.succeed({ id: 'patch-set-1', ...input, createdAt: input.createdAt ?? 1 } as never),
        recordReviewRun: (input) =>
          Effect.suspend(() => {
            recorded.push({ type: 'reviewRun', value: input })
            return Effect.succeed({ id: 'review-run-1', ...input, createdAt: input.createdAt ?? 1 } as never)
          }),
        recordReviewFinding: (input) =>
          Effect.suspend(() => {
            recorded.push({ type: 'finding', value: input })
            return Effect.succeed({ id: `finding-${recorded.length}`, ...input, createdAt: input.createdAt ?? 1 } as never)
          }),
        recordPolicyDecision: (input) =>
          Effect.suspend(() => {
            recorded.push({ type: 'policy', value: input })
            return Effect.succeed({ id: 'policy-1', ...input, createdAt: input.createdAt ?? 1 } as never)
          }),
        recordPublicationResult: (input) => Effect.succeed({ id: 'publication-1', ...input, createdAt: input.createdAt ?? 1 } as never),
        recordProvenanceEvent: (input) => Effect.succeed({ id: 'provenance-1', ...input, sequence: 1, artifactRefs: input.artifactRefs ?? [] } as never),
      }))

      const result = yield* ProposeMergeDecision({
        workflowRunId: 'workflow-1',
        sandboxExecution,
        evidenceArtifacts: [diffArtifact],
      }).pipe(Effect.provide(Layer.mergeAll(storageLayer, AlphaReviewServiceLayer, AlphaPolicyServiceLayer)))

      expect(result.reviewRun.reviewer).toBe('patchplane:alpha-reviewer')
      expect(result.findings).toHaveLength(1)
      expect(result.findings[0]?.message).toContain('Sandbox command failed')
      expect(result.policyDecision).toMatchObject({
        status: 'changes-requested',
        reason: 'review:error',
      })
      expect(recorded.map((entry) => entry.type)).toEqual(['reviewRun', 'finding', 'policy'])
    }))
})
