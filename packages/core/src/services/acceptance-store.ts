import { Context, type Effect } from 'effect'
import type {
  AcceptanceDecision,
  ActiveAttemptConflictError,
  AttemptGeneration,
  AttemptNotFoundError,
  AttemptStatus,
  ChangeRequestId,
  ConflictingDecisionError,
  DecisionKind,
  DeliveryId,
  PersistenceError,
  ProposalVersion,
  StaleAttemptOwnershipError,
  VerificationAttempt,
  VerificationAttemptId,
} from '@patchplane/domain'

export interface DeliveryReceiptResult {
  readonly deliveryId: DeliveryId
  readonly inserted: boolean
}

export interface AcceptanceStoreService {
  readonly recordDeliveryReceipt: (input: {
    readonly deliveryId: DeliveryId
    readonly changeRequestId: ChangeRequestId
  }) => Effect.Effect<DeliveryReceiptResult, PersistenceError>

  readonly claimAttempt: (input: {
    readonly attemptId: VerificationAttemptId
    readonly changeRequestId: ChangeRequestId
  }) => Effect.Effect<
    VerificationAttempt,
    ActiveAttemptConflictError | PersistenceError
  >

  readonly advanceAttemptState: (input: {
    readonly attemptId: VerificationAttemptId
    readonly expectedGeneration: AttemptGeneration
    readonly nextStatus: AttemptStatus
  }) => Effect.Effect<
    VerificationAttempt,
    StaleAttemptOwnershipError | PersistenceError
  >

  readonly recordDecision: (input: {
    readonly decisionId: string
    readonly attemptId: VerificationAttemptId
    readonly proposalVersion: ProposalVersion
    readonly kind: DecisionKind
    readonly actorId: string
  }) => Effect.Effect<
    AcceptanceDecision,
    ConflictingDecisionError | PersistenceError
  >

  readonly findAttemptById: (
    attemptId: VerificationAttemptId,
  ) => Effect.Effect<
    VerificationAttempt,
    AttemptNotFoundError | PersistenceError
  >
}

export class AcceptanceStore extends Context.Service<
  AcceptanceStore,
  AcceptanceStoreService
>()('@patchplane/core/AcceptanceStore') {}

export interface VerificationStepRunnerService {
  readonly runPrepare: (input: {
    readonly attemptId: VerificationAttemptId
    readonly changeRequestId: ChangeRequestId
  }) => Effect.Effect<string, PersistenceError>
}

export class VerificationStepRunner extends Context.Service<
  VerificationStepRunner,
  VerificationStepRunnerService
>()('@patchplane/core/VerificationStepRunner') {}
