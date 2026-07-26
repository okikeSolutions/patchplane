import { describe, expect, it } from '@effect/vitest'
import {
  makeCandidatePatchSetId,
  makeEvidenceArtifactId,
  makeSandboxExecutionId,
  makeVerificationRequirementId,
  makeVerificationResultId,
  makeWorkflowRunId,
} from '@patchplane/domain/ids'
import type { VerificationRequirement, VerificationResult } from '@patchplane/domain/verification'
import { evaluateVerificationCoverage } from './evaluate-verification-coverage'

const workflowRunId = makeWorkflowRunId('run-1')
const requirement: VerificationRequirement = {
  id: makeVerificationRequirementId('requirement-1'),
  workflowRunId,
  key: 'unit-linux',
  label: 'Linux unit tests',
  kind: 'test',
  required: true,
  command: 'bun test',
  platform: 'linux',
  architecture: 'x64',
  requiredArtifactKinds: ['test-report'],
  source: 'repository-config',
  createdAt: 1,
}
const passingResult: VerificationResult = {
  id: makeVerificationResultId('result-1'),
  workflowRunId,
  requirementId: requirement.id,
  candidatePatchSetId: makeCandidatePatchSetId('candidate-a'),
  sandboxExecutionId: makeSandboxExecutionId('execution-1'),
  provider: 'daytona',
  command: 'bun test',
  platform: 'linux',
  architecture: 'x64',
  status: 'passed',
  exitCode: 0,
  artifactIds: [makeEvidenceArtifactId('artifact-1')],
  producedArtifactKinds: ['test-report'],
  candidateDigestBefore: 'sha256:a',
  candidateDigestAfter: 'sha256:a',
  startedAt: 2,
  completedAt: 3,
}

describe('evaluateVerificationCoverage', () => {
  it('does not apply a passing result to a different candidate', () => {
    expect(evaluateVerificationCoverage({
      candidatePatchSetId: makeCandidatePatchSetId('candidate-b'),
      requirements: [requirement],
      results: [passingResult],
    })).toMatchObject({
      status: 'incomplete',
      passedCount: 0,
      missingRequirementIds: ['requirement-1'],
      consideredResultIds: [],
    })
  })

  it('requires exit zero, unchanged candidate digest, and required artifacts', () => {
    expect(evaluateVerificationCoverage({
      candidatePatchSetId: makeCandidatePatchSetId('candidate-a'),
      requirements: [requirement],
      results: [passingResult],
    }).status).toBe('passed')

    for (const result of [
      { ...passingResult, exitCode: 1 },
      { ...passingResult, candidateDigestAfter: 'sha256:b' },
      { ...passingResult, producedArtifactKinds: [] },
      { ...passingResult, command: 'bun test --changed' },
      { ...passingResult, platform: 'macos' as const },
      { ...passingResult, architecture: 'arm64' },
    ]) {
      expect(evaluateVerificationCoverage({
        candidatePatchSetId: makeCandidatePatchSetId('candidate-a'),
        requirements: [requirement],
        results: [result],
      }).status).toBe('incomplete')
    }
  })

  it('distinguishes failed, blocked, and not-configured coverage', () => {
    expect(evaluateVerificationCoverage({
      candidatePatchSetId: makeCandidatePatchSetId('candidate-a'),
      requirements: [requirement],
      results: [{ ...passingResult, status: 'failed', exitCode: 2 }],
    }).status).toBe('failed')

    expect(evaluateVerificationCoverage({
      candidatePatchSetId: makeCandidatePatchSetId('candidate-a'),
      requirements: [requirement],
      results: [{ ...passingResult, status: 'blocked', exitCode: undefined }],
    }).status).toBe('incomplete')

    expect(evaluateVerificationCoverage({
      candidatePatchSetId: makeCandidatePatchSetId('candidate-a'),
      requirements: [],
      results: [],
    }).status).toBe('not-configured')
  })
})
