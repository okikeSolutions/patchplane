import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { ProjectCandidateChangedFiles } from './project-candidate-changed-files'

describe('projectCandidateChangedFiles', () => {
  it.effect('projects only file records from the candidate diff', () =>
    Effect.gen(function* () {
      const projection =
        yield* ProjectCandidateChangedFiles(`diff --git a/src/changed.ts b/src/changed.ts
index 1111111..2222222 100644
--- a/src/changed.ts
+++ b/src/changed.ts
@@ -1 +1,2 @@
-export const value = './src/unchanged.ts'
+export const value = './src/unchanged.ts'
+export const next = true
diff --git a/src/added.ts b/src/added.ts
new file mode 100644
--- /dev/null
+++ b/src/added.ts
@@ -0,0 +1 @@
+export const added = true
`)

      expect(projection).toEqual({
        files: [
          {
            path: 'src/changed.ts',
            changeKind: 'modified',
            contentKind: 'text',
            additions: 2,
            deletions: 1,
          },
          {
            path: 'src/added.ts',
            changeKind: 'added',
            contentKind: 'text',
            additions: 1,
            deletions: 0,
          },
        ],
        artifactTruncated: false,
        parseComplete: true,
        unsupportedRecords: 0,
      })
      expect(projection.files.map(({ path }) => path)).not.toContain(
        'src/unchanged.ts',
      )
    }),
  )

  it.effect('keeps artifact truncation separate from parsing completeness', () =>
    Effect.gen(function* () {
      const projection = yield* ProjectCandidateChangedFiles(
        `diff --git a/src/file.ts b/src/file.ts
--- a/src/file.ts
+++ b/src/file.ts
@@ -1 +1 @@
-old
+new
`,
        { artifactTruncated: true },
      )

      expect(projection.artifactTruncated).toBe(true)
      expect(projection.parseComplete).toBe(true)
      expect(projection.files.map(({ path }) => path)).toEqual(['src/file.ts'])
    }),
  )

  it.effect('projects combined diff records as unmerged files', () =>
    Effect.gen(function* () {
      const projection =
        yield* ProjectCandidateChangedFiles(`diff --cc src/merged.ts
index 1111111,2222222..3333333
diff --combined "src/quoted merged.ts"
index 4444444,5555555..6666666
`)

      expect(projection.files).toEqual([
        {
          path: 'src/merged.ts',
          changeKind: 'unmerged',
          contentKind: 'unknown',
        },
        {
          path: 'src/quoted merged.ts',
          changeKind: 'unmerged',
          contentKind: 'unknown',
        },
      ])
      expect(projection.parseComplete).toBe(true)
      expect(projection.unsupportedRecords).toBe(0)
    }),
  )

  it.effect('excludes unsupported diff record formats', () =>
    Effect.gen(function* () {
      const projection =
        yield* ProjectCandidateChangedFiles(`diff --raw src/file.ts
`)

      expect(projection.files).toEqual([])
      expect(projection.parseComplete).toBe(false)
      expect(projection.unsupportedRecords).toBe(1)
    }),
  )

  it.effect.each([
    ['absolute', '/src/file.ts'],
    ['parent traversal', '../secrets.txt'],
    ['nested parent traversal', 'src/../../secrets.txt'],
    ['empty segment', 'src//file.ts'],
    ['trailing separator', 'src/'],
  ])('rejects a malformed %s candidate path', ([_label, path]) =>
    Effect.gen(function* () {
      const projection =
        yield* ProjectCandidateChangedFiles(`diff --cc ${path}
index 1111111,2222222..3333333
`)

      expect(projection.files).toEqual([])
      expect(projection.parseComplete).toBe(false)
      expect(projection.unsupportedRecords).toBe(1)
    }),
  )

  it.effect('classifies git record metadata through ordered match cases', () =>
    Effect.gen(function* () {
      const projection =
        yield* ProjectCandidateChangedFiles(`diff --git a/old.ts b/new.ts
similarity index 100%
rename from old.ts
rename to new.ts
diff --git a/source.ts b/copy.ts
similarity index 100%
copy from source.ts
copy to copy.ts
diff --git a/script.sh b/script.sh
old mode 100644
new mode 100755
diff --git a/image.png b/image.png
new file mode 100644
GIT binary patch
literal 1
diff --git a/vendor b/vendor
index 1111111..2222222 160000
--- a/vendor
+++ b/vendor
@@ -1 +1 @@
-Subproject commit 1111111
+Subproject commit 2222222
`)

      expect(projection.files).toEqual([
        {
          path: 'new.ts',
          previousPath: 'old.ts',
          changeKind: 'renamed',
          contentKind: 'unknown',
        },
        {
          path: 'copy.ts',
          previousPath: 'source.ts',
          changeKind: 'copied',
          contentKind: 'unknown',
        },
        {
          path: 'script.sh',
          changeKind: 'type-changed',
          contentKind: 'unknown',
          oldMode: '100644',
          newMode: '100755',
        },
        {
          path: 'image.png',
          changeKind: 'added',
          contentKind: 'binary',
        },
        {
          path: 'vendor',
          changeKind: 'modified',
          contentKind: 'submodule',
          additions: 1,
          deletions: 1,
        },
      ])
      expect(projection.parseComplete).toBe(true)
    }),
  )

  it.effect('does not expose an unsafe previous path', () =>
    Effect.gen(function* () {
      const projection =
        yield* ProjectCandidateChangedFiles(`diff --git a/old.ts b/new.ts
similarity index 100%
rename from ../secrets.txt
rename to new.ts
`)

      expect(projection.files).toEqual([
        {
          path: 'new.ts',
          changeKind: 'renamed',
          contentKind: 'unknown',
        },
      ])
    }),
  )
})
