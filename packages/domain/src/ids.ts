import { Schema } from 'effect'

export const ActorId = Schema.String
export type ActorId = Schema.Schema.Type<typeof ActorId>

export const WorkspaceId = Schema.String
export type WorkspaceId = Schema.Schema.Type<typeof WorkspaceId>

export const PromptRequestId = Schema.String
export type PromptRequestId = Schema.Schema.Type<typeof PromptRequestId>

export const WorkflowRunId = Schema.String
export type WorkflowRunId = Schema.Schema.Type<typeof WorkflowRunId>
