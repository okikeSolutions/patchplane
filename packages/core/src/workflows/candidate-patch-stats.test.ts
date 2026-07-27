import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import type { SandboxCommandResult } from '../services/sandbox-service'
import { CandidatePatchStatsFromSandboxResult } from './candidate-patch-stats'

const baseResult: SandboxCommandResult = {
  provider: 'sandbox',
  sandboxId: 'sandbox-1',
  command: 'agent',
  exitCode: 0,
  stdout: '',
  baseSha: 'a'.repeat(40),
  startedAt: 1,
  completedAt: 2,
}

describe('candidatePatchStatsFromSandboxResult', () => {
  it.effect(
    'derives persisted candidate statistics from the captured diff body',
    () =>
      Effect.gen(function* () {
        const stats = yield* CandidatePatchStatsFromSandboxResult({
          ...baseResult,
          evidenceArtifacts: [
            {
              kind: 'diff',
              contentType: 'text/x-diff',
              body: `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1 +1,2 @@
-old
+new
+another
`,
            },
          ],
        })
        expect(stats).toEqual({ filesChanged: 1, additions: 2, deletions: 1 })
      }),
  )

  it.effect(
    'leaves statistics absent when the diff body cannot be parsed',
    () =>
      Effect.gen(function* () {
        const stats = yield* CandidatePatchStatsFromSandboxResult({
          ...baseResult,
          evidenceArtifacts: [
            {
              kind: 'diff',
              contentType: 'text/x-diff',
              body: new Uint8Array([1, 2, 3]),
            },
          ],
        })
        expect(stats).toBeUndefined()
      }),
  )
})
