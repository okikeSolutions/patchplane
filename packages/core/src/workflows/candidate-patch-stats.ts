import { Effect, Option } from 'effect'
import type { CandidatePatchSetStats } from '@patchplane/domain/decision-review'
import { ParseUnifiedDiffStats } from '../diff/parse-unified-diff-stats'
import type { SandboxCommandResult } from '../services/sandbox-service'

export const CandidatePatchStatsFromSandboxResult = Effect.fn(
  '@patchplane/core/workflows/CandidatePatchStatsFromSandboxResult',
)(function* (
  result: SandboxCommandResult,
): Effect.fn.Return<CandidatePatchSetStats | undefined> {
  const body = result.evidenceArtifacts?.find(
    (artifact) => artifact.kind === 'diff',
  )?.body
  if (typeof body !== 'string') return undefined

  const parsed = yield* ParseUnifiedDiffStats(body).pipe(Effect.option)
  return Option.getOrUndefined(parsed)
})
