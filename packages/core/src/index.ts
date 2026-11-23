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
  ArtifactStore,
  type ArtifactStoreService,
} from './services/artifact-store'

export {
  assertAllowedSandboxEnvKey,
  buildAttemptSandboxLabels,
  buildValidatedSandboxEnv,
  MAX_MODEL_CREDENTIAL_TTL_MS,
  PATCHPLANE_ATTEMPT_ID_LABEL,
  PATCHPLANE_CHANGE_REQUEST_ID_LABEL,
  PATCHPLANE_MANAGED_LABEL,
  PATCHPLANE_PURPOSE_LABEL,
  SANDBOX_ATTEMPT_ID_ENV,
  SANDBOX_MODEL_GATEWAY_URL_ENV,
  SANDBOX_MODEL_TOKEN_ENV,
  type ShortLivedAttemptModelCredential,
  type ValidatedSandboxEnv,
} from './services/sandbox-credential-policy'

export {
  type QuarantineResult,
  SandboxLifecycleStore,
  type SandboxLifecycleStoreService,
} from './services/sandbox-lifecycle-store'

export {
  type SandboxExecOutput,
  SandboxProvider,
  type SandboxProviderService,
  type SandboxSummary,
} from './services/sandbox-provider'

export {
  type CleanupPolicyOptions,
  confirmSandboxDeletion,
  DEFAULT_CLEANUP_POLL_INTERVAL_MS,
  DEFAULT_CLEANUP_TIMEOUT_MS,
  type IsolatedSandboxCheckResult,
  type LeakReconciliationReport,
  reconcileLeakedSandboxes,
  runIsolatedCheckInSandbox,
} from './workflows/sandbox-verification-workflow'

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
