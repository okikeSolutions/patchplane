import { afterAll, describe, expect, test } from 'vitest'
import { ProjectCandidateChangedFiles } from '@patchplane/core/diff/project-candidate-changed-files'
import {
  diffProjectionRuntime,
  disposeDiffProjectionRuntime,
} from './diff-runtime'

describe('diffProjectionRuntime', () => {
  afterAll(async () => {
    await disposeDiffProjectionRuntime()
  })

  test('runs candidate projection without constructing the server plugin layer', async () => {
    const projection = await diffProjectionRuntime.runPromise(
      ProjectCandidateChangedFiles(`diff --git a/src/value.ts b/src/value.ts
--- a/src/value.ts
+++ b/src/value.ts
@@ -1 +1 @@
-export const value = false
+export const value = true
`),
    )

    expect(projection).toMatchObject({
      files: [
        {
          path: 'src/value.ts',
          additions: 1,
          deletions: 1,
        },
      ],
      parseComplete: true,
      unsupportedRecords: 0,
    })
  })
})
