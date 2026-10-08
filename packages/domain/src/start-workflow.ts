import { Schema } from 'effect'
import { Actor } from './actor'
import { PromptRequestSource } from './prompt-request'
import { Workspace } from './workspace'

export const StartWorkflowPromptInput = Schema.Struct({
  prompt: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(16_000)),
})
export type StartWorkflowPromptInput = Schema.Schema.Type<
  typeof StartWorkflowPromptInput
>

export const StartWorkflowInput = Schema.Struct({
  actor: Actor,
  workspace: Workspace,
  source: PromptRequestSource,
  traceId: Schema.NonEmptyString,
  prompt: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(16_000)),
})
export type StartWorkflowInput = Schema.Schema.Type<typeof StartWorkflowInput>
