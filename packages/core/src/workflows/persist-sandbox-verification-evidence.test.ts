import { describe, expect, it } from '@effect/vitest'
import {
  makeCandidatePatchSetId,
  makeVerificationRequirementId,
  makeWorkflowRunId,
} from '@patchplane/domain/ids'
import { evaluateVerificationCoverage } from '../verification/evaluate-verification-coverage'
import {
  configuredVerificationDefinitions,
  deriveDurableVerificationStatus,
} from './persist-sandbox-verification-evidence'

const succeeded = {
  kind: 'test' as const,
  command: 'bun test',
  status: 'succeeded' as const,
  exitCode: 0,
}

describe('configured verification requirements', () => {
  it('exists before a provider produces any result', () => {
    expect(
      configuredVerificationDefinitions({ testCommand: 'bun test' }),
    ).toEqual([
      expect.objectContaining({
        key: 'sandbox:test',
        command: 'bun test',
        requiredArtifactKinds: ['test-report'],
      }),
    ])
  })

  it('reports incomplete when a configured verifier produces no result', () => {
    const definition = configuredVerificationDefinitions({
      testCommand: 'bun test',
    })[0]
    if (definition === undefined)
      throw new Error('Expected configured test requirement')
    const requirementId = makeVerificationRequirementId('requirement-no-result')
    const coverage = evaluateVerificationCoverage({
      candidatePatchSetId: makeCandidatePatchSetId('candidate-no-result'),
      requirements: [
        {
          id: requirementId,
          workflowRunId: makeWorkflowRunId('workflow-no-result'),
          ...definition,
          required: true,
          source: 'policy',
          createdAt: 1,
        },
      ],
      results: [],
    })

    expect(coverage.status).toBe('incomplete')
    expect(coverage.missingRequirementIds).toEqual([requirementId])
  })
})

describe('durable sandbox verification status', () => {
  it('passes only with an unchanged candidate and required artifact', () => {
    expect(deriveDurableVerificationStatus(succeeded, true, true)).toBe(
      'passed',
    )
    expect(deriveDurableVerificationStatus(succeeded, false, true)).toBe(
      'invalidated',
    )
    expect(deriveDurableVerificationStatus(succeeded, true, false)).toBe(
      'error',
    )
  })

  it('distinguishes command failure from evidence capture error', () => {
    expect(
      deriveDurableVerificationStatus(
        { ...succeeded, status: 'failed', exitCode: 2 },
        true,
        true,
      ),
    ).toBe('failed')
    expect(
      deriveDurableVerificationStatus(
        { ...succeeded, status: 'failed', exitCode: undefined },
        true,
        true,
      ),
    ).toBe('error')
    expect(
      deriveDurableVerificationStatus(
        { ...succeeded, status: 'failed', exitCode: 0 },
        true,
        false,
      ),
    ).toBe('error')
  })
})
