import { Schema } from 'effect'

export const ExecutionTargetSchema = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  key: Schema.String,
  repositoryConnectionId: Schema.optional(Schema.String),
  sandboxProvider: Schema.String,
  runtimeProvider: Schema.String,
  defaultBaseBranch: Schema.optional(Schema.String),
  enabled: Schema.Boolean,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type ExecutionTarget = Schema.Schema.Type<typeof ExecutionTargetSchema>

export const PolicyBundleSchema = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  key: Schema.String,
  requiredReviewers: Schema.Array(Schema.String),
  minimumScore: Schema.Number,
  enabled: Schema.Boolean,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type PolicyBundle = Schema.Schema.Type<typeof PolicyBundleSchema>
