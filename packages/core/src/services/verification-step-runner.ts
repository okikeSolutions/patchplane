import { Context, type Effect } from 'effect'
import type {
  ChangeRequestId,
  PrepareDigest,
  StepRunnerError,
  VerificationAttemptId,
} from '@patchplane/domain'

export interface VerificationStepRunnerService {
  readonly runPrepare: (input: {
    readonly attemptId: VerificationAttemptId
    readonly changeRequestId: ChangeRequestId
  }) => Effect.Effect<PrepareDigest, StepRunnerError>
}

export class VerificationStepRunner extends Context.Service<
  VerificationStepRunner,
  VerificationStepRunnerService
>()('@patchplane/core/VerificationStepRunner') {}
