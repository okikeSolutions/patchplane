import { Context, Effect } from 'effect'
import type {
  PolicyDecisionStatus,
  ReviewFinding,
} from '@patchplane/domain/decision-review'
import type { StorageError } from '@patchplane/domain/errors'
import type { SandboxExecution } from '@patchplane/domain/sandbox-execution'
import type { TelemetryContextFields } from './telemetry-service'

export interface EvaluatePolicyInput extends TelemetryContextFields {
  readonly workflowRunId: string
  readonly sandboxExecution?: SandboxExecution | undefined
  readonly reviewFindings: ReadonlyArray<ReviewFinding>
}

export interface EvaluatePolicyResult {
  readonly status: PolicyDecisionStatus
  readonly summary: string
  readonly reason?: string | undefined
}

export class PolicyService extends Context.Service<PolicyService, {
  readonly evaluatePolicy: (
    input: EvaluatePolicyInput,
  ) => Effect.Effect<EvaluatePolicyResult, StorageError>
}>()('@patchplane/core/services/PolicyService') {}
