import { Context, type Effect } from 'effect'
import type {
  AcceptanceDecision,
  ActiveAttemptConflictError,
  ActorId,
  AttemptGeneration,
  AttemptNotFoundError,
  AttemptStatus,
  AttemptTransitionKey,
  ChangeRequestId,
  ConflictingDecisionError,
  DecisionId,
  DecisionKind,
  DeliveryId,
  InvalidAttemptTransitionError,
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

  /**
   * Fenced, state-machine-checked transition. `transitionKey` makes a replay of
   * an already-applied transition idempotent; callers without a key always
   * receive `StaleAttemptOwnershipError` once the generation has moved on.
   */
  readonly advanceAttemptState: (input: {
    readonly attemptId: VerificationAttemptId
    readonly expectedGeneration: AttemptGeneration
    readonly nextStatus: AttemptStatus
    readonly transitionKey?: AttemptTransitionKey
  }) => Effect.Effect<
    VerificationAttempt,
    | AttemptNotFoundError
    | StaleAttemptOwnershipError
    | InvalidAttemptTransitionError
    | PersistenceError
  >

  readonly recordDecision: (input: {
    readonly decisionId: DecisionId
    readonly attemptId: VerificationAttemptId
    readonly proposalVersion: ProposalVersion
    readonly kind: DecisionKind
    readonly actorId: ActorId
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
