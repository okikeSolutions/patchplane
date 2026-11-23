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

export const ProposalVersion = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThan(0),
).pipe(Schema.brand('ProposalVersion'))
export type ProposalVersion = typeof ProposalVersion.Type

export const AttemptGeneration = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThan(0),
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

export class ConflictingDecisionError extends Schema.TaggedError<
  ConflictingDecisionError,
  { readonly brand: unique symbol }
>()('ConflictingDecisionError', {
  attemptId: VerificationAttemptId,
  proposalVersion: ProposalVersion,
  existingKind: DecisionKind,
  requestedKind: DecisionKind,
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
