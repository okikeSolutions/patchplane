import { Context, Effect } from 'effect'
import type { RuntimeError } from '@patchplane/domain/errors'

export interface RuntimeEvent {
  readonly type: string
  readonly occurredAt: number
  readonly summary?: string | undefined
  readonly payload?: unknown
}

export interface RuntimePromptInput {
  readonly prompt: string
  readonly traceId: string
}

export interface RuntimePromptResult {
  readonly provider: string
  readonly events: ReadonlyArray<RuntimeEvent>
  readonly summary: string
}

export interface RuntimeControlInput {
  readonly traceId: string
}

export interface RuntimeMessageInput extends RuntimeControlInput {
  readonly message: string
}

export class RuntimeService extends Context.Service<RuntimeService, {
  readonly abort: (input: RuntimeControlInput) => Effect.Effect<void, RuntimeError>
  readonly followUp: (input: RuntimeMessageInput) => Effect.Effect<void, RuntimeError>
  readonly runPrompt: (
    input: RuntimePromptInput,
  ) => Effect.Effect<RuntimePromptResult, RuntimeError>
  readonly steer: (input: RuntimeMessageInput) => Effect.Effect<void, RuntimeError>
}>()('@patchplane/core/services/RuntimeService') {}
