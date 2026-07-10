import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  decodeCandidatePatchSet,
  decodeHumanDecision,
  decodePolicyDecision,
  decodePublicationResult,
  decodeReviewFinding,
  decodeReviewRun,
} from './decision-review'

describe('decision/review domain schemas', () => {
  it.effect('decodes the durable M10 decision and publication records', () =>
    Effect.gen(function* () {
      const patchSet = yield* decodeCandidatePatchSet({
        id: 'patch_1',
        workflowRunId: 'workflow_1',
        status: 'captured',
        diffArtifactId: 'artifact_1',
        stats: { filesChanged: 2, additions: 10, deletions: 3 },
        createdAt: 10,
      })
      const reviewRun = yield* decodeReviewRun({
        id: 'review_1',
        workflowRunId: 'workflow_1',
        kind: 'test',
        reviewer: 'patchplane:test-reviewer',
        status: 'completed',
        startedAt: 11,
        completedAt: 12,
        createdAt: 11,
      })
      const finding = yield* decodeReviewFinding({
        id: 'finding_1',
        workflowRunId: 'workflow_1',
        reviewRunId: 'review_1',
        severity: 'error',
        category: 'test',
        message: 'Unit test failed',
        path: 'src/foo.test.ts',
        startLine: 7,
        endLine: 8,
        createdAt: 12,
      })
      const policyDecision = yield* decodePolicyDecision({
        id: 'policy_1',
        workflowRunId: 'workflow_1',
        reviewRunId: 'review_1',
        status: 'changes-requested',
        summary: 'Tests failed',
        createdAt: 13,
      })
      const humanDecision = yield* decodeHumanDecision({
        id: 'human_1',
        workflowRunId: 'workflow_1',
        actorId: 'workos:user_123',
        status: 'rejected',
        comment: 'Failing tests need a fix first.',
        decidedAt: 14,
        idempotencyKey: 'decision-attempt-1',
      })
      const publication = yield* decodePublicationResult({
        id: 'publication_1',
        workflowRunId: 'workflow_1',
        provider: 'github',
        kind: 'check-run',
        status: 'published',
        externalId: '123',
        url: 'https://github.com/example/repo/runs/123',
        createdAt: 15,
      })

      expect(patchSet.status).toBe('captured')
      expect(reviewRun.status).toBe('completed')
      expect(finding.severity).toBe('error')
      expect(policyDecision.status).toBe('changes-requested')
      expect(humanDecision.actorId).toBe('workos:user_123')
      expect(humanDecision.idempotencyKey).toBe('decision-attempt-1')
      expect(publication.kind).toBe('check-run')
    }))
})
