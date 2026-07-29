import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { makeWorkflowRunId } from './ids'
import {
  decodeVerificationExecutionGroup,
  decodeVerificationRequirement,
  decodeVerificationResult,
} from './verification'

describe('verification evidence schemas', () => {
  it.effect('decodes a candidate-bound native-platform result', () =>
    Effect.gen(function* () {
      const requirement = yield* decodeVerificationRequirement({
        id: 'requirement-macos',
        workflowRunId: makeWorkflowRunId('run-1'),
        key: 'desktop-macos',
        label: 'macOS desktop smoke',
        kind: 'test',
        required: true,
        command: 'bun run agent:smoke:macos',
        platform: 'macos',
        architecture: 'arm64',
        requiredArtifactKinds: ['test-report'],
        source: 'repository-config',
        createdAt: 1,
      })
      const result = yield* decodeVerificationResult({
        id: 'result-1',
        workflowRunId: makeWorkflowRunId('run-1'),
        requirementId: requirement.id,
        candidatePatchSetId: 'candidate-1',
        sandboxExecutionId: 'execution-1',
        provider: 'isolated-macos',
        command: requirement.command,
        platform: 'macos',
        architecture: 'arm64',
        status: 'passed',
        exitCode: 0,
        artifactIds: ['test-report-1'],
        producedArtifactKinds: ['test-report'],
        candidateDigestBefore: `sha256:${'a'.repeat(64)}`,
        candidateDigestAfter: `sha256:${'a'.repeat(64)}`,
        startedAt: 2,
        completedAt: 3,
      })

      expect(result).toMatchObject({
        requirementId: 'requirement-macos',
        candidatePatchSetId: 'candidate-1',
        platform: 'macos',
        status: 'passed',
      })
    }),
  )

  it.effect('rejects oversized provider process identities', () =>
    decodeVerificationExecutionGroup({
      id: 'group-1',
      workflowRunId: makeWorkflowRunId('run-1'),
      verificationPlanId: 'plan-1',
      requirementId: 'requirement-1',
      candidatePatchSetId: 'candidate-1',
      stableKey: 'plan-1:requirement-1:candidate-1',
      provider: 'daytona',
      platform: 'linux',
      architecture: 'x86_64',
      sharedState: false,
      status: 'running',
      sandboxId: 'sandbox-1',
      providerSessionId: 's'.repeat(257),
      providerCommandId: 'command-1',
      claimedAt: 1,
      startedAt: 2,
    }).pipe(Effect.flip, Effect.asVoid),
  )

  it.effect('rejects an unknown result status', () =>
    decodeVerificationResult({
      id: 'result-1',
      workflowRunId: makeWorkflowRunId('run-1'),
      requirementId: 'requirement-1',
      candidatePatchSetId: 'candidate-1',
      provider: 'daytona',
      platform: 'linux',
      architecture: 'x64',
      status: 'succeeded',
      artifactIds: [],
      producedArtifactKinds: [],
      candidateDigestBefore: `sha256:${'a'.repeat(64)}`,
      startedAt: 1,
    }).pipe(Effect.flip, Effect.asVoid),
  )
})
