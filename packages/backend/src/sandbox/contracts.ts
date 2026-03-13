import { Effect } from 'effect'
import type { RuntimeAdapter } from '../runtime/contracts'
import type { ExecutionFailure } from '../errors'
import type { RuntimeEvent } from '@patchplane/domain'

export interface SandboxAdapter {
  readonly name: string
  execute(
    requestId: string,
    runtime: RuntimeAdapter,
  ): Effect.Effect<ReadonlyArray<RuntimeEvent>, ExecutionFailure>
}
