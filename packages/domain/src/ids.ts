import { Schema } from 'effect'

export const PromptRequestIdSchema = Schema.NonEmptyTrimmedString.pipe(
  Schema.brand('PromptRequestId'),
)
export type PromptRequestId = Schema.Schema.Type<typeof PromptRequestIdSchema>
export const PromptRequestId = Schema.decodeSync(PromptRequestIdSchema)

export const WorkflowRunIdSchema = Schema.NonEmptyTrimmedString.pipe(
  Schema.brand('WorkflowRunId'),
)
export type WorkflowRunId = Schema.Schema.Type<typeof WorkflowRunIdSchema>
export const WorkflowRunId = Schema.decodeSync(WorkflowRunIdSchema)

export const RuntimeSessionIdSchema = Schema.NonEmptyTrimmedString.pipe(
  Schema.brand('RuntimeSessionId'),
)
export type RuntimeSessionId = Schema.Schema.Type<typeof RuntimeSessionIdSchema>
export const RuntimeSessionId = Schema.decodeSync(RuntimeSessionIdSchema)

export const ExecutionTargetIdSchema = Schema.NonEmptyTrimmedString.pipe(
  Schema.brand('ExecutionTargetId'),
)
export type ExecutionTargetId = Schema.Schema.Type<
  typeof ExecutionTargetIdSchema
>
export const ExecutionTargetId = Schema.decodeSync(ExecutionTargetIdSchema)

export const PolicyBundleIdSchema = Schema.NonEmptyTrimmedString.pipe(
  Schema.brand('PolicyBundleId'),
)
export type PolicyBundleId = Schema.Schema.Type<typeof PolicyBundleIdSchema>
export const PolicyBundleId = Schema.decodeSync(PolicyBundleIdSchema)

export const GitHubInstallationIdSchema = Schema.NonEmptyTrimmedString.pipe(
  Schema.brand('GitHubInstallationId'),
)
export type GitHubInstallationId = Schema.Schema.Type<
  typeof GitHubInstallationIdSchema
>
export const GitHubInstallationId = Schema.decodeSync(
  GitHubInstallationIdSchema,
)

export const RepositoryConnectionIdSchema = Schema.NonEmptyTrimmedString.pipe(
  Schema.brand('RepositoryConnectionId'),
)
export type RepositoryConnectionId = Schema.Schema.Type<
  typeof RepositoryConnectionIdSchema
>
export const RepositoryConnectionId = Schema.decodeSync(
  RepositoryConnectionIdSchema,
)
