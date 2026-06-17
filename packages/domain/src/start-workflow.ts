import { Schema } from 'effect'
import { Actor } from './actor'
import { PromptRequestSource } from './prompt-request'
import { Workspace } from './workspace'

export const StartWorkflowPromptInput = Schema.Struct({
  prompt: Schema.String.check(Schema.isNonEmpty()),
})
export type StartWorkflowPromptInput = Schema.Schema.Type<
  typeof StartWorkflowPromptInput
>

export const StartWorkflowInput = Schema.Struct({
  actor: Actor,
  workspace: Workspace,
  source: PromptRequestSource,
  traceId: Schema.String,
  prompt: Schema.String,
})
export type StartWorkflowInput = Schema.Schema.Type<typeof StartWorkflowInput>
