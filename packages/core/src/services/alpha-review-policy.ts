import { Effect, Layer } from 'effect'
import { ReviewService, type ReviewCandidateInput } from './review-service'
import { PolicyService } from './policy-service'

export const AlphaReviewServiceLayer = Layer.succeed(
  ReviewService,
  ReviewService.of({
    runReview: (input: ReviewCandidateInput) =>
      Effect.sync(() => {
        const findings = []
        const diffArtifact = input.evidenceArtifacts.find((artifact) => artifact.kind === 'diff')
        const verificationResults = input.verificationResults ?? []

        if (verificationResults.length === 0) {
          findings.push({
            severity: 'warning' as const,
            category: 'test' as const,
            message: 'No independent verification command was configured; agent completion is not test evidence.',
          })
        }

        for (const verification of verificationResults) {
          if (verification.status === 'passed') continue
          const failed = verification.status === 'failed'
          findings.push({
            severity: failed ? 'error' as const : 'warning' as const,
            category: 'test' as const,
            message: verification.summary ?? `Verification ${verification.status} with exit ${verification.exitCode ?? 'unknown'}.`,
          })
        }

        if (input.sandboxExecution === undefined) {
          findings.push({
            severity: 'warning' as const,
            category: 'unknown' as const,
            message: 'No sandbox execution has been recorded for this workflow.',
          })
        } else if (input.sandboxExecution.status === 'failed') {
          findings.push({
            severity: 'error' as const,
            category: 'test' as const,
            message: `Sandbox command failed with exit ${input.sandboxExecution.exitCode ?? 'unknown'}.`,
          })
        }

        if (diffArtifact === undefined) {
          findings.push({
            severity: 'warning' as const,
            category: 'quality' as const,
            message: 'No candidate patch diff artifact was recorded.',
          })
        }

        return {
          kind: 'test' as const,
          reviewer: 'patchplane:alpha-reviewer',
          summary: findings.length === 0
            ? 'Sandbox execution and candidate diff evidence are present.'
            : `${findings.length} review finding${findings.length === 1 ? '' : 's'} recorded.`,
          findings,
        }
      }),
  }),
)

export const AlphaPolicyServiceLayer = Layer.succeed(
  PolicyService,
  PolicyService.of({
    evaluatePolicy: (input) =>
      Effect.sync(() => {
        const hasError = input.reviewFindings.some((finding) =>
          finding.severity === 'error' || finding.severity === 'critical'
        )
        const hasWarning = input.reviewFindings.some((finding) => finding.severity === 'warning')

        if (
          input.sandboxExecution?.status === 'failed' ||
          input.verificationCoverage.status === 'failed' ||
          hasError
        ) {
          return {
            status: 'changes-requested' as const,
            summary: 'PatchPlane found failing execution, verification, or error-level review findings.',
            reason: 'review:error',
          }
        }

        if (
          input.sandboxExecution === undefined ||
          input.candidatePatchSet?.status !== 'captured' ||
          input.verificationCoverage.status !== 'passed' ||
          hasWarning
        ) {
          return {
            status: 'manual-review' as const,
            summary: input.verificationCoverage.status === 'passed'
              ? 'PatchPlane needs human review before this patch can be trusted.'
              : 'Verification is incomplete; PatchPlane needs human review before this patch can be trusted.',
            reason: input.verificationCoverage.status === 'passed'
              ? 'review:warning'
              : 'verification:incomplete',
          }
        }

        return {
          status: 'manual-review' as const,
          summary: 'PatchPlane found no blocking automated findings; human approval is still required.',
          reason: 'review:clean',
        }
      }),
  }),
)
