import { Schema } from 'effect'
import { ExternalWorkflowRef } from './external-workflow-ref'
import { ActorId, PromptRequestId, WorkspaceId } from './ids'

export const PromptRequestSource = Schema.Literals([
  'dev',
  'app',
  'external',
])
export type PromptRequestSource = Schema.Schema.Type<
  typeof PromptRequestSource
>

export const PromptRequestStatus = Schema.Literals(['created'])
export type PromptRequestStatus = Schema.Schema.Type<
  typeof PromptRequestStatus
>

export const PromptRequest = Schema.Struct({
  id: PromptRequestId,
  workspaceId: WorkspaceId,
  actorId: ActorId,
  traceId: Schema.String,
  source: PromptRequestSource,
  prompt: Schema.String,
  externalRef: Schema.optional(ExternalWorkflowRef),
  status: PromptRequestStatus,
  createdAt: Schema.Number,
})
export type PromptRequest = Schema.Schema.Type<typeof PromptRequest>

export const decodePromptRequest = Schema.decodeUnknownEffect(PromptRequest)
