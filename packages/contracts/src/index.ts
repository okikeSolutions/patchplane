import { Context, Schema } from 'effect'
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
  HttpApiSecurity,
} from 'effect/http-api'
import {
  AcceptanceDecision,
  AttemptGeneration,
  AttemptStatus,
  ChangeRequestId,
  DecisionKind,
  EpochMillis,
  ProposalVersion,
  RepositoryId,
  VerificationAttemptId,
  type WorkOsAuthenticatedIdentity,
} from '@patchplane/domain'

export const InboxRevision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
export type InboxRevision = typeof InboxRevision.Type

export const AttemptSummary = Schema.Struct({
  attemptId: VerificationAttemptId,
  changeRequestId: ChangeRequestId,
  repositoryId: RepositoryId,
  title: Schema.NonEmptyString,
  status: AttemptStatus,
  generation: AttemptGeneration,
  proposalVersion: ProposalVersion,
  nextAction: Schema.NonEmptyString,
  updatedAtMs: EpochMillis,
})
export interface AttemptSummary extends Schema.Schema.Type<
  typeof AttemptSummary
> {}

export const InboxDiffFile = Schema.Struct({
  path: Schema.NonEmptyString,
  hunkCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  additions: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  deletions: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
})
export interface InboxDiffFile extends Schema.Schema.Type<
  typeof InboxDiffFile
> {}

export const AttemptDetail = Schema.Struct({
  revision: InboxRevision,
  summary: AttemptSummary,
  diffText: Schema.String,
  files: Schema.Array(InboxDiffFile),
  decision: Schema.NullOr(AcceptanceDecision),
})
export interface AttemptDetail extends Schema.Schema.Type<
  typeof AttemptDetail
> {}

export const InboxSnapshot = Schema.Struct({
  revision: InboxRevision,
  items: Schema.Array(AttemptSummary),
})
export interface InboxSnapshot extends Schema.Schema.Type<
  typeof InboxSnapshot
> {}

export const SubmitDecisionPayload = Schema.Struct({
  proposalVersion: ProposalVersion,
  kind: DecisionKind,
})
export interface SubmitDecisionPayload extends Schema.Schema.Type<
  typeof SubmitDecisionPayload
> {}

export const SubmitDecisionResponse = Schema.Struct({
  decision: AcceptanceDecision,
  summary: AttemptSummary,
})
export interface SubmitDecisionResponse extends Schema.Schema.Type<
  typeof SubmitDecisionResponse
> {}

export const InboxSnapshotEvent = Schema.TaggedStruct('InboxSnapshotEvent', {
  revision: InboxRevision,
  items: Schema.Array(AttemptSummary),
})
export interface InboxSnapshotEvent extends Schema.Schema.Type<
  typeof InboxSnapshotEvent
> {}

export const InboxUpdatedEvent = Schema.TaggedStruct('InboxUpdatedEvent', {
  revision: InboxRevision,
  summary: AttemptSummary,
})
export interface InboxUpdatedEvent extends Schema.Schema.Type<
  typeof InboxUpdatedEvent
> {}

export const VerificationStatusChangedEvent = Schema.TaggedStruct(
  'VerificationStatusChangedEvent',
  {
    revision: InboxRevision,
    attemptId: VerificationAttemptId,
    repositoryId: RepositoryId,
    status: AttemptStatus,
    generation: AttemptGeneration,
    nextAction: Schema.NonEmptyString,
    updatedAtMs: EpochMillis,
  },
)
export interface VerificationStatusChangedEvent extends Schema.Schema.Type<
  typeof VerificationStatusChangedEvent
> {}

export const DecisionRecordedEvent = Schema.TaggedStruct(
  'DecisionRecordedEvent',
  {
    revision: InboxRevision,
    decision: AcceptanceDecision,
    summary: AttemptSummary,
  },
)
export interface DecisionRecordedEvent extends Schema.Schema.Type<
  typeof DecisionRecordedEvent
> {}

export const DecisionInboxStreamEvent = Schema.Union([
  InboxSnapshotEvent,
  InboxUpdatedEvent,
  VerificationStatusChangedEvent,
  DecisionRecordedEvent,
])
export type DecisionInboxStreamEvent = typeof DecisionInboxStreamEvent.Type

export class InboxUnauthorizedError extends Schema.TaggedError<
  InboxUnauthorizedError,
  { readonly brand: unique symbol }
>()('InboxUnauthorizedError', {
  message: Schema.NonEmptyString,
}) {}

export class InboxForbiddenError extends Schema.TaggedError<
  InboxForbiddenError,
  { readonly brand: unique symbol }
>()('InboxForbiddenError', {
  message: Schema.NonEmptyString,
}) {}

export class InboxAttemptNotFoundError extends Schema.TaggedError<
  InboxAttemptNotFoundError,
  { readonly brand: unique symbol }
>()('InboxAttemptNotFoundError', {
  attemptId: VerificationAttemptId,
  message: Schema.NonEmptyString,
}) {}

export class InboxDecisionConflictError extends Schema.TaggedError<
  InboxDecisionConflictError,
  { readonly brand: unique symbol }
>()('InboxDecisionConflictError', {
  attemptId: VerificationAttemptId,
  proposalVersion: ProposalVersion,
  message: Schema.NonEmptyString,
}) {}

export class InboxServerError extends Schema.TaggedError<
  InboxServerError,
  { readonly brand: unique symbol }
>()('InboxServerError', {
  message: Schema.NonEmptyString,
}) {}

const UnauthorizedErrorSchema = InboxUnauthorizedError.pipe(
  HttpApiSchema.status(401),
)
const ForbiddenErrorSchema = InboxForbiddenError.pipe(HttpApiSchema.status(403))
const AttemptNotFoundErrorSchema = InboxAttemptNotFoundError.pipe(
  HttpApiSchema.status(404),
)
const DecisionConflictErrorSchema = InboxDecisionConflictError.pipe(
  HttpApiSchema.status(409),
)
const ServerErrorSchema = InboxServerError.pipe(HttpApiSchema.status(500))

export class CurrentInboxCaller extends Context.Service<
  CurrentInboxCaller,
  WorkOsAuthenticatedIdentity
>()('@patchplane/contracts/CurrentInboxCaller') {}

export class DecisionInboxAuthMiddleware extends HttpApiMiddleware.Service<
  DecisionInboxAuthMiddleware,
  { provides: CurrentInboxCaller }
>()('@patchplane/contracts/DecisionInboxAuthMiddleware', {
  error: UnauthorizedErrorSchema,
  security: {
    bearer: HttpApiSecurity.http({ scheme: 'bearer' }),
  },
}) {}

export const DecisionInboxApiGroup = HttpApiGroup.make('inbox')
  .add(
    HttpApiEndpoint.get('listInbox', '/', {
      success: InboxSnapshot,
      error: [UnauthorizedErrorSchema, ForbiddenErrorSchema, ServerErrorSchema],
    }),
    HttpApiEndpoint.get('getAttemptDetail', '/attempts/:attemptId', {
      params: {
        attemptId: VerificationAttemptId,
      },
      success: AttemptDetail,
      error: [
        UnauthorizedErrorSchema,
        ForbiddenErrorSchema,
        AttemptNotFoundErrorSchema,
        ServerErrorSchema,
      ],
    }),
    HttpApiEndpoint.post('submitDecision', '/attempts/:attemptId/decisions', {
      params: {
        attemptId: VerificationAttemptId,
      },
      payload: SubmitDecisionPayload,
      success: SubmitDecisionResponse,
      error: [
        UnauthorizedErrorSchema,
        ForbiddenErrorSchema,
        AttemptNotFoundErrorSchema,
        DecisionConflictErrorSchema,
        ServerErrorSchema,
      ],
    }),
    HttpApiEndpoint.get('streamEvents', '/events', {
      success: HttpApiSchema.StreamSse({
        data: DecisionInboxStreamEvent,
        error: UnauthorizedErrorSchema,
        keepAlive: '15 seconds',
      }),
      error: [UnauthorizedErrorSchema, ForbiddenErrorSchema, ServerErrorSchema],
    }),
  )
  .middleware(DecisionInboxAuthMiddleware)
  .prefix('/api/v2/inbox')

export const DecisionInboxApi = HttpApi.make('patchplane-decision-inbox').add(
  DecisionInboxApiGroup,
)

// ---------------------------------------------------------------------------
// React Diff Island Contract (view data in, typed interaction events out)
// ---------------------------------------------------------------------------

export const DiffIslandViewData = Schema.Struct({
  attemptId: VerificationAttemptId,
  proposalVersion: ProposalVersion,
  diffText: Schema.String,
  focusedFilePath: Schema.NullOr(Schema.NonEmptyString),
})
export interface DiffIslandViewData extends Schema.Schema.Type<
  typeof DiffIslandViewData
> {}

export const DiffFileFocusedEvent = Schema.TaggedStruct('FileFocused', {
  attemptId: VerificationAttemptId,
  path: Schema.NonEmptyString,
})
export interface DiffFileFocusedEvent extends Schema.Schema.Type<
  typeof DiffFileFocusedEvent
> {}

export const DiffLineSelectedEvent = Schema.TaggedStruct('LineSelected', {
  attemptId: VerificationAttemptId,
  path: Schema.NonEmptyString,
  lineNumber: Schema.Int.check(Schema.isGreaterThan(0)),
})
export interface DiffLineSelectedEvent extends Schema.Schema.Type<
  typeof DiffLineSelectedEvent
> {}

export const DiffIslandEvent = Schema.Union([
  DiffFileFocusedEvent,
  DiffLineSelectedEvent,
])
export type DiffIslandEvent = typeof DiffIslandEvent.Type
