import { Schema } from 'effect'

export const ChangeRequestId = Schema.NonEmptyString.pipe(
  Schema.brand('ChangeRequestId'),
)
export type ChangeRequestId = typeof ChangeRequestId.Type

export const VerificationAttemptId = Schema.NonEmptyString.pipe(
  Schema.brand('VerificationAttemptId'),
)
export type VerificationAttemptId = typeof VerificationAttemptId.Type

export const DeliveryId = Schema.NonEmptyString.pipe(Schema.brand('DeliveryId'))
export type DeliveryId = typeof DeliveryId.Type

export const DecisionId = Schema.NonEmptyString.pipe(Schema.brand('DecisionId'))
export type DecisionId = typeof DecisionId.Type

export const ActorId = Schema.NonEmptyString.pipe(Schema.brand('ActorId'))
export type ActorId = typeof ActorId.Type

export const PrepareDigest = Schema.NonEmptyString.pipe(
  Schema.brand('PrepareDigest'),
)
export type PrepareDigest = typeof PrepareDigest.Type

const PG_INT4_MAX = 2_147_483_647

/**
 * Scrubs embedded URI credentials, password query parameters, and bearer tokens
 * before an external error is persisted in workflow journals or emitted to logs.
 */
export const sanitizeErrorMessage = (cause: unknown): string => {
  const raw =
    cause instanceof Error && cause.message.length > 0
      ? `${cause.name}: ${cause.message}`
      : String(cause)
  return raw
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)([^/\s@]+)@/gi, '$1<redacted>@')
    .replace(
      /([?&](?:password|passwd|pwd|token|secret|api[_-]?key)=)[^&\s]+/gi,
      '$1<redacted>',
    )
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1<redacted>')
}

export const ProposalVersion = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(PG_INT4_MAX),
).pipe(Schema.brand('ProposalVersion'))
export type ProposalVersion = typeof ProposalVersion.Type

export const AttemptGeneration = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(PG_INT4_MAX),
).pipe(Schema.brand('AttemptGeneration'))
export type AttemptGeneration = typeof AttemptGeneration.Type

export const AttemptStatus = Schema.Literals([
  'pending',
  'running',
  'passed',
  'incomplete',
  'failed',
  'cancelled',
])
export type AttemptStatus = typeof AttemptStatus.Type

/**
 * Idempotency key for one attempt state transition. A replay that presents the
 * same key for an already-applied transition returns the persisted row instead
 * of failing ownership fencing, so a workflow activity that crashed after the
 * database commit (but before its journal entry) can be retried safely.
 */
export const AttemptTransitionKey = Schema.NonEmptyString.pipe(
  Schema.brand('AttemptTransitionKey'),
)
export type AttemptTransitionKey = typeof AttemptTransitionKey.Type

const ATTEMPT_TRANSITIONS: {
  readonly [From in AttemptStatus]: ReadonlyArray<AttemptStatus>
} = {
  pending: ['running', 'cancelled'],
  running: ['passed', 'failed', 'incomplete', 'cancelled'],
  passed: [],
  incomplete: [],
  failed: [],
  cancelled: [],
}

/** Terminal attempts never re-open; every other transition must be listed. */
export const canTransitionAttempt = (
  from: AttemptStatus,
  to: AttemptStatus,
): boolean => ATTEMPT_TRANSITIONS[from].includes(to)

export const DecisionKind = Schema.Literals(['approve', 'reject', 'waive'])
export type DecisionKind = typeof DecisionKind.Type

export const ChangeRequest = Schema.Struct({
  id: ChangeRequestId,
  provider: Schema.Literal('github'),
  repositoryId: Schema.NonEmptyString,
  headSha: Schema.NonEmptyString,
})
export interface ChangeRequest extends Schema.Schema.Type<
  typeof ChangeRequest
> {}

export const VerificationAttempt = Schema.Struct({
  id: VerificationAttemptId,
  changeRequestId: ChangeRequestId,
  status: AttemptStatus,
  generation: AttemptGeneration,
})
export interface VerificationAttempt extends Schema.Schema.Type<
  typeof VerificationAttempt
> {}

export const AcceptanceDecision = Schema.Struct({
  id: DecisionId,
  attemptId: VerificationAttemptId,
  proposalVersion: ProposalVersion,
  kind: DecisionKind,
  actorId: ActorId,
})
export interface AcceptanceDecision extends Schema.Schema.Type<
  typeof AcceptanceDecision
> {}

export class AttemptNotFoundError extends Schema.TaggedError<
  AttemptNotFoundError,
  { readonly brand: unique symbol }
>()('AttemptNotFoundError', {
  attemptId: VerificationAttemptId,
}) {}

export class ActiveAttemptConflictError extends Schema.TaggedError<
  ActiveAttemptConflictError,
  { readonly brand: unique symbol }
>()('ActiveAttemptConflictError', {
  changeRequestId: ChangeRequestId,
}) {}

export class StaleAttemptOwnershipError extends Schema.TaggedError<
  StaleAttemptOwnershipError,
  { readonly brand: unique symbol }
>()('StaleAttemptOwnershipError', {
  attemptId: VerificationAttemptId,
  expectedGeneration: AttemptGeneration,
}) {}

export class InvalidAttemptTransitionError extends Schema.TaggedError<
  InvalidAttemptTransitionError,
  { readonly brand: unique symbol }
>()('InvalidAttemptTransitionError', {
  attemptId: VerificationAttemptId,
  from: AttemptStatus,
  to: AttemptStatus,
}) {}

export class ConflictingDecisionError extends Schema.TaggedError<
  ConflictingDecisionError,
  { readonly brand: unique symbol }
>()('ConflictingDecisionError', {
  attemptId: VerificationAttemptId,
  proposalVersion: ProposalVersion,
  existingKind: DecisionKind,
  requestedKind: DecisionKind,
  existingActorId: ActorId,
  requestedActorId: ActorId,
}) {}

export class PersistenceError extends Schema.TaggedError<
  PersistenceError,
  { readonly brand: unique symbol }
>()('PersistenceError', {
  operation: Schema.NonEmptyString,
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export class StepRunnerError extends Schema.TaggedError<
  StepRunnerError,
  { readonly brand: unique symbol }
>()('StepRunnerError', {
  operation: Schema.NonEmptyString,
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export class MigrationFailureError extends Schema.TaggedError<
  MigrationFailureError,
  { readonly brand: unique symbol }
>()('MigrationFailureError', {
  migrationName: Schema.NonEmptyString,
  reason: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}
