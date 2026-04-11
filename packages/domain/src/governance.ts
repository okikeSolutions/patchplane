import { Schema } from 'effect'
import {
  PolicyBundleIdSchema,
  PromptRequestIdSchema,
  RuntimeSessionIdSchema,
  WorkflowRunIdSchema,
} from './ids'
import { MergeDecisionStatusSchema } from './workflow'

export const pendingApprovalStatuses = [
  'pending',
  'approved',
  'rejected',
  'cancelled',
] as const

export const pendingApprovalResolutionStatuses = [
  'approved',
  'rejected',
  'cancelled',
] as const

export const PendingApprovalStatusSchema = Schema.Literal(
  ...pendingApprovalStatuses,
)
export type PendingApprovalStatus = Schema.Schema.Type<
  typeof PendingApprovalStatusSchema
>

export const PendingApprovalResolutionStatusSchema = Schema.Literal(
  ...pendingApprovalResolutionStatuses,
)
export type PendingApprovalResolutionStatus = Schema.Schema.Type<
  typeof PendingApprovalResolutionStatusSchema
>

export const pendingInputStatuses = [
  'pending',
  'resolved',
  'cancelled',
] as const

export const pendingInputResolutionStatuses = ['resolved', 'cancelled'] as const

export const PendingInputStatusSchema = Schema.Literal(...pendingInputStatuses)
export type PendingInputStatus = Schema.Schema.Type<
  typeof PendingInputStatusSchema
>

export const PendingInputResolutionStatusSchema = Schema.Literal(
  ...pendingInputResolutionStatuses,
)
export type PendingInputResolutionStatus = Schema.Schema.Type<
  typeof PendingInputResolutionStatusSchema
>

export const PendingApprovalSchema = Schema.Struct({
  id: Schema.String,
  promptRequestId: PromptRequestIdSchema,
  workflowRunId: WorkflowRunIdSchema,
  runtimeSessionId: Schema.optional(RuntimeSessionIdSchema),
  kind: Schema.String,
  title: Schema.String,
  body: Schema.optional(Schema.String),
  status: PendingApprovalStatusSchema,
  requestedByUserId: Schema.String,
  resolvedByUserId: Schema.optional(Schema.String),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  resolvedAt: Schema.optional(Schema.Number),
})
export type PendingApproval = Schema.Schema.Type<typeof PendingApprovalSchema>

export const PendingInputSchema = Schema.Struct({
  id: Schema.String,
  promptRequestId: PromptRequestIdSchema,
  workflowRunId: WorkflowRunIdSchema,
  runtimeSessionId: Schema.optional(RuntimeSessionIdSchema),
  kind: Schema.String,
  prompt: Schema.String,
  status: PendingInputStatusSchema,
  requestedByUserId: Schema.String,
  response: Schema.optional(Schema.String),
  resolvedByUserId: Schema.optional(Schema.String),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  resolvedAt: Schema.optional(Schema.Number),
})
export type PendingInput = Schema.Schema.Type<typeof PendingInputSchema>

export const MergeDecisionSchema = Schema.Struct({
  id: Schema.String,
  workflowRunId: WorkflowRunIdSchema,
  policyBundleId: Schema.optional(PolicyBundleIdSchema),
  status: MergeDecisionStatusSchema,
  reasons: Schema.Array(Schema.String),
  decidedByUserId: Schema.optional(Schema.String),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  decidedAt: Schema.optional(Schema.Number),
})
export type MergeDecision = Schema.Schema.Type<typeof MergeDecisionSchema>
