import { Context, Effect, Match } from 'effect'
import type { AttemptSummary } from '@patchplane/contracts'
import type {
  AttemptNotFoundError,
  AttemptStatus,
  VerificationAttempt,
  VerificationAttemptId,
} from '@patchplane/domain'

export {
  AcceptanceStore,
  type AcceptanceStoreService,
  type DeliveryReceiptResult,
} from './services/acceptance-store'

export {
  VerificationStepRunner,
  type VerificationStepRunnerService,
} from './services/verification-step-runner'

export {
  VerificationAttemptWorkflow,
  VerificationAttemptWorkflowError,
  VerificationAttemptWorkflowLayer,
  VerificationAttemptWorkflowPayload,
  VerificationAttemptWorkflowResult,
} from './workflows/verification-attempt-workflow'

export interface AttemptStoreService {
  readonly findById: (
    attemptId: VerificationAttemptId,
  ) => Effect.Effect<VerificationAttempt, AttemptNotFoundError>
}

export class AttemptStore extends Context.Service<
  AttemptStore,
  AttemptStoreService
>()('@patchplane/core/AttemptStore') {}

export const nextActionForStatus = (status: AttemptStatus): string =>
  Match.value(status).pipe(
    Match.when('pending', () => 'Awaiting requirement approval'),
    Match.when('running', () => 'Verification in progress'),
    Match.when('passed', () => 'Ready for maintainer review'),
    Match.when('incomplete', () => 'Inspect missing or blocked evidence'),
    Match.when('failed', () => 'Inspect failing check or challenge check'),
    Match.when('cancelled', () => 'Superseded or stopped'),
    Match.exhaustive,
  )

export const getAttemptSummary = Effect.fn('Patchplane.getAttemptSummary')(
  function* (
    attemptId: VerificationAttemptId,
  ): Effect.fn.Return<AttemptSummary, AttemptNotFoundError, AttemptStore> {
    const store = yield* AttemptStore
    const attempt = yield* store.findById(attemptId)
    return {
      attemptId: attempt.id,
      changeRequestId: attempt.changeRequestId,
      status: attempt.status,
      nextAction: nextActionForStatus(attempt.status),
    }
  },
)
