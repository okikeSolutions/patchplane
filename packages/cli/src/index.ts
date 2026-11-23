import type { BunChildProcessSpawner } from '@effect/platform-bun'
import { Effect } from 'effect'
import type { AttemptSummary } from '@patchplane/contracts'

export type CliSpawnerLayer = typeof BunChildProcessSpawner.layer

export const formatAttemptSummaryLine = Effect.fn(
  'Cli.formatAttemptSummaryLine',
)(function* (summary: AttemptSummary) {
  return yield* Effect.succeed(
    `[${summary.status}] ${summary.attemptId}: ${summary.nextAction}`,
  )
})
