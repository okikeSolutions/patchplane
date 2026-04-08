import { Effect } from 'effect'
import type { PatchPlaneCommand } from '@patchplane/domain'

export function processPatchPlaneCommandsSequentially<Result, Error>(
  commands: ReadonlyArray<PatchPlaneCommand>,
  process: (command: PatchPlaneCommand) => Effect.Effect<Result, Error>,
): Effect.Effect<ReadonlyArray<Result>, Error> {
  return Effect.forEach(commands, process)
}
