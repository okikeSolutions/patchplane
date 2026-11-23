import { Schema } from 'effect'
import {
  AttemptStatus,
  ChangeRequestId,
  VerificationAttemptId,
} from '@patchplane/domain'

export const AttemptSummary = Schema.Struct({
  attemptId: VerificationAttemptId,
  changeRequestId: ChangeRequestId,
  status: AttemptStatus,
  nextAction: Schema.NonEmptyString,
})
export type AttemptSummary = typeof AttemptSummary.Type

export const InboxUpdatedEvent = Schema.TaggedStruct('InboxUpdatedEvent', {
  summary: AttemptSummary,
})
export type InboxUpdatedEvent = typeof InboxUpdatedEvent.Type
