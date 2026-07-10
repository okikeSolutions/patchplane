import { Context, Effect } from 'effect'
import type {
  ReviewFindingCategory,
  ReviewFindingSeverity,
  ReviewRunKind,
} from '@patchplane/domain/decision-review'
import type { StorageError } from '@patchplane/domain/errors'
import type { EvidenceArtifact } from '@patchplane/domain/evidence-artifact'
import type { SandboxExecution } from '@patchplane/domain/sandbox-execution'
import type { TelemetryContextFields } from './telemetry-service'

export interface ReviewCandidateInput extends TelemetryContextFields {
  readonly workflowRunId: string
  readonly sandboxExecution?: SandboxExecution | undefined
  readonly evidenceArtifacts: ReadonlyArray<EvidenceArtifact>
}

export interface ProposedReviewFinding {
  readonly severity: ReviewFindingSeverity
  readonly category: ReviewFindingCategory
  readonly message: string
  readonly evidenceArtifactId?: string | undefined
}

export interface ReviewCandidateResult {
  readonly kind: ReviewRunKind
  readonly reviewer: string
  readonly summary: string
  readonly findings: ReadonlyArray<ProposedReviewFinding>
}

export class ReviewService extends Context.Service<ReviewService, {
  readonly runReview: (
    input: ReviewCandidateInput,
  ) => Effect.Effect<ReviewCandidateResult, StorageError>
}>()('@patchplane/core/services/ReviewService') {}
