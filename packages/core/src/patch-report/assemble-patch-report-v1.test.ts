import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  makePullRequestExternalId,
  makePullRequestNumber,
  makeRepositoryExternalId,
} from '@patchplane/domain/candidate-subject'
import type {
  CandidatePatchSet,
  HumanDecision,
  PolicyDecision,
  ReviewRun,
} from '@patchplane/domain/decision-review'
import {
  makeCandidatePatchSetId,
  makeEvidenceArtifactId,
  makeHumanDecisionId,
  makePolicyDecisionId,
  makePromptRequestId,
  makeReviewRunId,
  makeSandboxExecutionId,
  makeSystemActorId,
  makeSystemWorkspaceId,
  makeVerificationExecutionGroupId,
  makeVerificationPlanId,
  makeVerificationRequirementId,
  makeVerificationResultId,
  makeWorkflowRunId,
} from '@patchplane/domain/ids'
import type { SandboxExecution } from '@patchplane/domain/sandbox-execution'
import { makeGitCommitSha } from '@patchplane/domain/refinements'
import type {
  VerificationRequirement,
  VerificationResult,
} from '@patchplane/domain/verification'
import { AssemblePatchReportV1 } from './assemble-patch-report-v1'

const workflowRunId = makeWorkflowRunId('run-1')
const workflowStart = {
  promptRequest: {
    id: makePromptRequestId('prompt-1'),
    workspaceId: makeSystemWorkspaceId('workspace-1'),
    actorId: makeSystemActorId('actor-1'),
    traceId: 'trace-1',
    source: 'external' as const,
    prompt: 'Fix Save As without losing the current document.',
    status: 'created' as const,
    createdAt: 1,
  },
  workflowRun: {
    id: workflowRunId,
    promptRequestId: makePromptRequestId('prompt-1'),
    workspaceId: makeSystemWorkspaceId('workspace-1'),
    traceId: 'trace-1',
    status: 'reviewed' as const,
    modelVersion: 'v1' as const,
    rootWorkflowRunId: workflowRunId,
    attemptNumber: 1,
    trigger: 'intake' as const,
    sourceCommitSha: makeGitCommitSha('a'.repeat(40)),
    createdAt: 1,
  },
}
const execution: SandboxExecution = {
  id: makeSandboxExecutionId('execution-1'),
  workflowRunId,
  provider: 'daytona',
  sandboxId: 'sandbox-1',
  command: 'pi',
  status: 'succeeded',
  exitCode: 0,
  stdout: 'done',
  startedAt: 2,
  completedAt: 3,
}
const candidate: CandidatePatchSet = {
  id: makeCandidatePatchSetId('candidate-1'),
  workflowRunId,
  sandboxExecutionId: execution.id,
  status: 'captured',
  candidateDigest: `sha256:${'b'.repeat(64)}`,
  baseSha: makeGitCommitSha('a'.repeat(40)),
  diffArtifactId: makeEvidenceArtifactId('diff-1'),
  createdAt: 4,
}
const requirement: VerificationRequirement = {
  id: makeVerificationRequirementId('requirement-1'),
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
  createdAt: 4,
}
const result: VerificationResult = {
  id: makeVerificationResultId('result-1'),
  workflowRunId,
  requirementId: requirement.id,
  candidatePatchSetId: candidate.id,
  sandboxExecutionId: execution.id,
  provider: 'daytona',
  command: 'bun test',
  platform: 'linux',
  architecture: 'x64',
  status: 'passed',
  exitCode: 0,
  artifactIds: [makeEvidenceArtifactId('test-report-1')],
  producedArtifactKinds: ['test-report'],
  candidateDigestBefore: candidate.candidateDigest!,
  candidateDigestAfter: candidate.candidateDigest!,
  startedAt: 4,
  completedAt: 5,
}
const review: ReviewRun = {
  id: makeReviewRunId('review-1'),
  workflowRunId,
  sandboxExecutionId: execution.id,
  candidatePatchSetId: candidate.id,
  kind: 'test',
  reviewer: 'patchplane:alpha-reviewer',
  status: 'completed',
  startedAt: 5,
  completedAt: 6,
  createdAt: 5,
}
const policy: PolicyDecision = {
  id: makePolicyDecisionId('policy-1'),
  workflowRunId,
  reviewRunId: review.id,
  candidatePatchSetId: candidate.id,
  status: 'manual-review',
  summary: 'Configured verification passed; human approval is required.',
  policyVersion: 'alpha-v1',
  verificationResultIds: [result.id],
  missingRequirementIds: [],
  createdAt: 6,
}
const decision: HumanDecision = {
  id: makeHumanDecisionId('decision-1'),
  workflowRunId,
  sandboxExecutionId: execution.id,
  candidatePatchSetId: candidate.id,
  reviewRunId: review.id,
  policyDecisionId: policy.id,
  actorId: makeSystemActorId('reviewer-1'),
  status: 'approved',
  comment: 'Evidence is sufficient.',
  decidedAt: 7,
}

function assemble(
  overrides: Partial<Parameters<typeof AssemblePatchReportV1>[0]> = {},
) {
  return AssemblePatchReportV1({
    workflowStart,
    sandboxExecutions: [execution],
    candidatePatchSets: [candidate],
    verificationRequirements: [requirement],
    verificationResults: [result],
    reviewRuns: [review],
    reviewFindings: [],
    policyDecisions: [policy],
    humanDecisions: [decision],
    evidenceArtifacts: [],
    publicationResults: [],
    trustDataTruncated: false,
    ...overrides,
  })
}

describe('AssemblePatchReportV1', () => {
  it.effect('refuses to upgrade legacy workflow evidence into V1', () =>
    AssemblePatchReportV1({
      workflowStart: {
        ...workflowStart,
        workflowRun: { ...workflowStart.workflowRun, modelVersion: undefined },
      },
      sandboxExecutions: [execution],
      candidatePatchSets: [candidate],
      verificationRequirements: [],
      verificationResults: [],
      reviewRuns: [],
      reviewFindings: [],
      policyDecisions: [],
      humanDecisions: [],
      evidenceArtifacts: [],
      publicationResults: [],
      trustDataTruncated: false,
    }).pipe(
      Effect.flip,
      Effect.tap((error) =>
        Effect.sync(() =>
          expect(error.message).toContain('Legacy workflow evidence'),
        ),
      ),
      Effect.asVoid,
    ),
  )

  it.effect(
    'does not correlate a candidate produced by another execution',
    () =>
      Effect.gen(function* () {
        const report = yield* assemble({
          candidatePatchSets: [
            {
              ...candidate,
              sandboxExecutionId: makeSandboxExecutionId('another-execution'),
            },
          ],
        })
        expect(report.candidate.status).toBe('missing')
        expect(report.trustStatus).toBe('untrusted')
      }),
  )
  it.effect(
    'projects separate execution, verification, policy, and trust states',
    () =>
      Effect.gen(function* () {
        const report = yield* assemble()
        expect(report).toMatchObject({
          trustStatus: 'approved',
          execution: { status: 'completed' },
          candidate: { status: 'captured', digest: `sha256:${'b'.repeat(64)}` },
          verification: { status: 'passed', requiredCount: 1, passedCount: 1 },
          policy: { status: 'manual-review', policyVersion: 'alpha-v1' },
          decision: { status: 'approved' },
        })
      }),
  )

  it.effect('projects a frozen incoming candidate without a producer execution', () =>
    Effect.gen(function* () {
      const incomingCandidate: CandidatePatchSet = {
        ...candidate,
        sandboxExecutionId: undefined,
        subject: {
          kind: 'incoming-pull-request',
          repositoryProvider: 'github',
          repositoryExternalId: makeRepositoryExternalId('1'),
          repositoryOwner: 'patchplane',
          repositoryName: 'demo',
          repositoryFullName: 'patchplane/demo',
          pullRequestExternalId: makePullRequestExternalId('2'),
          pullRequestNumber: makePullRequestNumber(2),
          baseSha: makeGitCommitSha('a'.repeat(40)),
          headSha: makeGitCommitSha('f'.repeat(40)),
          sourceEventProvider: 'github',
          sourceEventDeliveryId: 'delivery-1',
          sourceEventKind: 'github.pull_request.opened',
        },
        headSha: makeGitCommitSha('f'.repeat(40)),
      }
      const incomingResult = { ...result, candidatePatchSetId: incomingCandidate.id }
      const report = yield* assemble({
        candidatePatchSets: [incomingCandidate],
        verificationResults: [incomingResult],
      })
      expect(report.candidate.candidatePatchSetId).toBe(incomingCandidate.id)
      expect(report.verification.checks[0]?.resultId).toBe(incomingResult.id)
    }),
  )

  it.effect('projects trusted execution envelope identity and command logs', () =>
    Effect.gen(function* () {
      const envelopeResult: VerificationResult = {
        ...result,
        verificationPlanId: makeVerificationPlanId('plan-1'),
        executionGroupId: makeVerificationExecutionGroupId('group-1'),
        commandDigest: `sha256:${'e'.repeat(64)}`,
        stdoutArtifactId: makeEvidenceArtifactId('stdout-1'),
        stderrArtifactId: makeEvidenceArtifactId('stderr-1'),
        cleanupStatus: 'deleted',
      }
      const report = yield* assemble({ verificationResults: [envelopeResult] })
      expect(report.verification.checks[0]).toMatchObject({
        verificationPlanId: envelopeResult.verificationPlanId,
        executionGroupId: envelopeResult.executionGroupId,
        commandDigest: envelopeResult.commandDigest,
        stdoutArtifactId: envelopeResult.stdoutArtifactId,
        stderrArtifactId: envelopeResult.stderrArtifactId,
        cleanupStatus: 'deleted',
      })
    }),
  )

  it.effect('does not apply a decision or result from another candidate', () =>
    Effect.gen(function* () {
      const newerCandidate = {
        ...candidate,
        id: makeCandidatePatchSetId('candidate-2'),
        candidateDigest: `sha256:${'c'.repeat(64)}`,
        createdAt: 8,
      }
      const report = yield* assemble({
        candidatePatchSets: [candidate, newerCandidate],
      })
      expect(report.trustStatus).toBe('untrusted')
      expect(report.verification.status).toBe('incomplete')
      expect(report.decision.status).toBe('pending')
      expect(report.reasons).toContain('verification:incomplete')
    }),
  )

  it.effect(
    'keeps an approved report bound to policy-time verification when later evidence arrives',
    () =>
      Effect.gen(function* () {
        const laterFailure: VerificationResult = {
          ...result,
          id: makeVerificationResultId('result-later-failure'),
          status: 'failed',
          exitCode: 2,
          startedAt: 8,
          completedAt: 9,
        }
        const report = yield* assemble({
          verificationResults: [result, laterFailure],
        })

        expect(report.trustStatus).toBe('approved')
        expect(report.verification.status).toBe('passed')
        expect(report.verification.checks[0]?.resultId).toBe(result.id)
      }),
  )

  it.effect(
    'fails closed when any trust-bearing report input was truncated',
    () =>
      Effect.gen(function* () {
        const report = yield* assemble({ trustDataTruncated: true })

        expect(report.trustStatus).toBe('untrusted')
        expect(report.verification.status).toBe('incomplete')
        expect(report.decision.status).toBe('pending')
        expect(report.reasons).toContain('report:trust-data-truncated')
      }),
  )

  it.effect(
    'reports successful agent execution without checks as not configured, not verified',
    () =>
      Effect.gen(function* () {
        const report = yield* assemble({
          verificationRequirements: [],
          verificationResults: [],
          reviewRuns: [],
          policyDecisions: [],
          humanDecisions: [],
        })
        expect(report.execution.status).toBe('completed')
        expect(report.verification.status).toBe('not-configured')
        expect(report.trustStatus).toBe('untrusted')
        expect(report.reasons).toContain('verification:not-configured')
      }),
  )
})
