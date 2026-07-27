import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  makeCandidatePatchSetId,
  makeSandboxExecutionId,
  makeWorkflowRunId,
} from '@patchplane/domain/ids'
import { AlphaPolicyServiceLayer } from './alpha-review-policy'
import { PolicyService } from './policy-service'

const workflowRunId = makeWorkflowRunId('workflow-1')

describe('AlphaPolicyServiceLayer', () => {
  it.effect('describes passed coverage without calling the patch clean', () =>
    Effect.gen(function* () {
      const policy = yield* PolicyService
      const result = yield* policy.evaluatePolicy({
        workflowRunId,
        sandboxExecution: {
          id: makeSandboxExecutionId('execution-1'),
          workflowRunId,
          provider: 'daytona',
          sandboxId: 'sandbox-1',
          command: 'bun test',
          status: 'succeeded',
          exitCode: 0,
          stdout: 'ok',
          startedAt: 1,
          completedAt: 2,
        },
        candidatePatchSet: {
          id: makeCandidatePatchSetId('candidate-1'),
          workflowRunId,
          status: 'captured',
          createdAt: 2,
        },
        verificationCoverage: {
          status: 'passed',
          requiredCount: 1,
          passedCount: 1,
          failedRequirementIds: [],
          missingRequirementIds: [],
          consideredResultIds: [],
        },
        reviewFindings: [],
      })

      expect(result).toEqual({
        status: 'manual-review',
        summary:
          'Required verification passed and 0 blocking review findings were recorded; human approval is still required.',
        reason: 'review:clean',
      })
      expect(result.summary.toLowerCase()).not.toContain('clean')
    }).pipe(Effect.provide(AlphaPolicyServiceLayer)),
  )
})
