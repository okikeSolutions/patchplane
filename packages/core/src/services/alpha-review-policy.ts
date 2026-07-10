import { Effect, Layer } from 'effect'
import { ReviewService } from './review-service'
import { PolicyService } from './policy-service'

export const AlphaReviewServiceLayer = Layer.succeed(
  ReviewService,
  ReviewService.of({
    runReview: (input) =>
      Effect.sync(() => {
        const findings = []
        const diffArtifact = input.evidenceArtifacts.find((artifact) => artifact.kind === 'diff')

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

        if (input.sandboxExecution?.status === 'failed' || hasError) {
          return {
            status: 'changes-requested' as const,
            summary: 'PatchPlane found failing execution or error-level review findings.',
            reason: 'review:error',
          }
        }

        if (input.sandboxExecution === undefined || hasWarning) {
          return {
            status: 'manual-review' as const,
            summary: 'PatchPlane needs human review before this patch can be trusted.',
            reason: 'review:warning',
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
