import { Effect } from 'effect'
import type { RuntimeEvent } from '@patchplane/domain'
import type { ExecutionFailure } from '../errors'

export interface RuntimeAdapter {
  readonly name: string
  run(requestId: string): Effect.Effect<RuntimeEvent[], ExecutionFailure>
}
