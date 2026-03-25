import { Schema } from 'effect'
import { PromptRequestSourceSchema, PromptScopeSchema } from './workflow'

export const PromptRequestCommandSchema = Schema.Struct({
  kind: Schema.Literal('prompt_request.create'),
  projectId: Schema.String,
  executionTargetId: Schema.String,
  policyBundleId: Schema.String,
  createdByUserId: Schema.String,
  prompt: Schema.String,
  scope: PromptScopeSchema,
  source: PromptRequestSourceSchema,
})

export type PromptRequestCommand = Schema.Schema.Type<
  typeof PromptRequestCommandSchema
>

export const PatchPlaneCommandSchema = Schema.Union(PromptRequestCommandSchema)
export type PatchPlaneCommand = Schema.Schema.Type<
  typeof PatchPlaneCommandSchema
>
