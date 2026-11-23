import { BunFileSystem, BunPath } from '@effect/platform-bun'
import { Effect, FileSystem, Layer, Path } from 'effect'
import { parseSync } from 'oxc-parser'

const IGNORED_DIRS = new Set([
  '.git',
  '.alchemy',
  'dist',
  'node_modules',
  'fixtures',
])

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])

const REPO_ROOT_URL = new URL('../..', import.meta.url)

export const ArchitecturePlatformLayer = Layer.merge(
  BunFileSystem.layer,
  BunPath.layer,
)

export const getRepoRoot = Effect.gen(function* () {
  const path = yield* Path.Path
  return path.resolve(yield* path.fromFileUrl(REPO_ROOT_URL))
})

export function toPosix(filePath: string): string {
  return filePath.split('\\').join('/')
}

export const readRepoFile = (repoRelativePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* getRepoRoot
    return yield* fs.readFileString(path.resolve(root, repoRelativePath))
  })

export const repoFileExists = (repoRelativePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* getRepoRoot
    return yield* fs.exists(path.resolve(root, repoRelativePath))
  })

export const listSourceFiles = (directory: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* getRepoRoot
    const start = path.resolve(root, directory)
    const results: Array<string> = []

    const walk = (
      current: string,
    ): Effect.Effect<
      void,
      FileSystem.FileSystem['stat'] extends (
        ...args: never[]
      ) => Effect.Effect<unknown, infer E>
        ? E
        : never
    > =>
      Effect.gen(function* () {
        const entries = yield* fs.readDirectory(current)
        for (const entry of entries) {
          if (IGNORED_DIRS.has(entry)) continue
          const absolute = path.join(current, entry)
          const info = yield* fs.stat(absolute)
          if (info.type === 'Directory') {
            yield* walk(absolute)
            continue
          }
          if (info.type !== 'File') continue
          const dot = entry.lastIndexOf('.')
          if (dot !== -1 && SOURCE_EXTENSIONS.has(entry.slice(dot))) {
            results.push(toPosix(path.relative(root, absolute)))
          }
        }
      })

    yield* walk(start)
    return results.toSorted()
  })

export function isProductionSourceFile(repoRelativePath: string): boolean {
  return (
    !repoRelativePath.endsWith('.test.ts') &&
    !repoRelativePath.endsWith('.test.tsx') &&
    !repoRelativePath.endsWith('.spec.ts') &&
    !repoRelativePath.endsWith('.spec.tsx') &&
    !repoRelativePath.endsWith('.d.ts') &&
    !repoRelativePath.includes('/test/')
  )
}

export function parseAst(repoRelativePath: string, source: string) {
  return parseSync(repoRelativePath, source, {
    sourceType: 'module',
  })
}

export function extractImportSpecifiers(
  repoRelativePath: string,
  source: string,
): ReadonlyArray<string> {
  const parsed = parseAst(repoRelativePath, source)
  const specifiers: string[] = []

  for (const imp of parsed.module.staticImports) {
    specifiers.push(imp.moduleRequest.value)
  }
  for (const exp of parsed.module.staticExports) {
    for (const entry of exp.entries) {
      if (entry.moduleRequest !== null) {
        specifiers.push(entry.moduleRequest.value)
      }
    }
  }
  for (const dyn of parsed.module.dynamicImports) {
    const raw = source.slice(dyn.moduleRequest.start, dyn.moduleRequest.end)
    const stripped = raw.replace(/^['"]|['"]$/g, '')
    if (stripped.length > 0) {
      specifiers.push(stripped)
    }
  }

  return specifiers
}
