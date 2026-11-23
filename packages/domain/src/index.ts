import { Schema } from 'effect'

export const ChangeRequestId = Schema.NonEmptyString.pipe(
  Schema.brand('ChangeRequestId'),
)
export type ChangeRequestId = typeof ChangeRequestId.Type

export const VerificationAttemptId = Schema.NonEmptyString.pipe(
  Schema.brand('VerificationAttemptId'),
)
export type VerificationAttemptId = typeof VerificationAttemptId.Type

export const AttemptStatus = Schema.Literals([
  'pending',
  'running',
  'passed',
  'incomplete',
  'failed',
  'cancelled',
])
export type AttemptStatus = typeof AttemptStatus.Type

export const ChangeRequest = Schema.Struct({
  id: ChangeRequestId,
  provider: Schema.Literal('github'),
  repositoryId: Schema.NonEmptyString,
  headSha: Schema.NonEmptyString,
})
export type ChangeRequest = typeof ChangeRequest.Type

export const VerificationAttempt = Schema.Struct({
  id: VerificationAttemptId,
  changeRequestId: ChangeRequestId,
  status: AttemptStatus,
})
export type VerificationAttempt = typeof VerificationAttempt.Type

export class AttemptNotFoundError extends Schema.TaggedError<
  AttemptNotFoundError,
  { readonly brand: unique symbol }
>()('AttemptNotFoundError', {
  attemptId: VerificationAttemptId,
}) {}
