import { Effect, Queue } from 'effect'
import type { PatchPlaneCommand } from '@patchplane/domain'

export function processPatchPlaneCommandsWithQueue<Result>(
  commands: ReadonlyArray<PatchPlaneCommand>,
  process: (
    command: PatchPlaneCommand,
  ) => Effect.Effect<Result, unknown, never>,
): Effect.Effect<ReadonlyArray<Result>, unknown, never> {
  return Effect.gen(function* () {
    const queue = yield* Queue.unbounded<PatchPlaneCommand>()

    for (const command of commands) {
      yield* Queue.offer(queue, command)
    }

    const results: Result[] = []

    for (let index = 0; index < commands.length; index += 1) {
      const command = yield* Queue.take(queue)
      const result = yield* process(command)
      results.push(result)
    }

    return results
  })
}
