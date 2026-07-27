import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  ParseUnifiedDiffStats,
  UnifiedDiffStatsUnavailable,
} from './parse-unified-diff-stats'

describe('parseUnifiedDiffStats', () => {
  it.effect('counts changed files and hunk additions and deletions', () =>
    Effect.gen(function* () {
      const result = yield* ParseUnifiedDiffStats(
        `diff --git a/src/first.ts b/src/first.ts
index 1111111..2222222 100644
--- a/src/first.ts
+++ b/src/first.ts
@@ -1,3 +1,4 @@
 const first = true
-const removed = true
+const added = true
+const second = true
 export { first }
diff --git a/src/second.ts b/src/second.ts
similarity index 100%
rename from src/old.ts
rename to src/second.ts
`,
      )

      expect(result).toEqual({ filesChanged: 2, additions: 2, deletions: 1 })
    }),
  )

  it.effect('does not count file headers as changed lines', () =>
    Effect.gen(function* () {
      const result = yield* ParseUnifiedDiffStats(`diff --git a/new.ts b/new.ts
new file mode 100644
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,2 @@
+first
+second
`)
      expect(result).toEqual({ filesChanged: 1, additions: 2, deletions: 0 })
    }),
  )

  it.effect.each([
    {
      name: 'empty',
      diff: '',
      reason: 'empty',
    },
    {
      name: 'binary',
      diff: `diff --git a/image.png b/image.png
new file mode 100644
GIT binary patch
literal 1
KcmZQzU|?Vb0RR91
`,
      reason: 'binary',
    },
    {
      name: 'malformed',
      diff: `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,2 +1,2 @@
-old
+new
`,
      reason: 'malformed',
    },
  ])('reports an explicit reason for a $name diff', ({ diff, reason }) =>
    Effect.gen(function* () {
      const error = yield* ParseUnifiedDiffStats(diff).pipe(Effect.flip)
      expect(error).toBeInstanceOf(UnifiedDiffStatsUnavailable)
      expect(error.reason).toBe(reason)
    }),
  )

  it.effect('refuses to parse beyond its configured bound', () =>
    Effect.gen(function* () {
      const error = yield* ParseUnifiedDiffStats('diff --git a/a b/a', {
        maximumBytes: 8,
      }).pipe(Effect.flip)
      expect(error).toBeInstanceOf(UnifiedDiffStatsUnavailable)
      expect(error.reason).toBe('oversized')
    }),
  )

  it.effect('counts a surrogate pair as four UTF-8 bytes', () =>
    Effect.gen(function* () {
      const error = yield* ParseUnifiedDiffStats('😀', {
        maximumBytes: 3,
      }).pipe(Effect.flip)
      expect(error).toBeInstanceOf(UnifiedDiffStatsUnavailable)
      expect(error.reason).toBe('oversized')
    }),
  )
})
