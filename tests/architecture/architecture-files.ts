import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Effect, FileSystem, Layer, Path } from 'effect'

export const ArchitectureFileSystemLayer = Layer.mergeAll(
  NodeFileSystem.layer,
  NodePath.layer,
)

const ignoredDirectories = new Set([
  '.git',
  '.turbo',
  '.temp',
  'dist',
  'node_modules',
  'vendor',
])

const sourceFileExtensions = new Set(['.ts', '.tsx', '.mts', '.cts'])

export interface ImportReference {
  readonly file: string
  readonly specifier: string
}

export interface PackageManifest {
  exports?: Record<string, string>
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

export function repoRoot() {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    let candidate = path.resolve(process.cwd())

    while (true) {
      const packageJsonPath = path.join(candidate, 'package.json')
      if (yield* fs.exists(packageJsonPath)) {
        const packageJson: unknown = JSON.parse(yield* fs.readFileString(packageJsonPath))
        if (
          typeof packageJson === 'object' &&
          packageJson !== null &&
          Reflect.get(packageJson, 'name') === 'patchplane-monorepo'
        ) {
          return candidate
        }
      }

      const parent = path.dirname(candidate)
      if (parent === candidate) {
        return path.resolve(process.cwd())
      }
      candidate = parent
    }
  })
}

function toPosix(path: string) {
  return path.split('\\').join('/')
}

export function relativeToRepo(file: string) {
  return Effect.gen(function* () {
    const path = yield* Path.Path
    const root = yield* repoRoot()
    return toPosix(path.relative(root, file))
  })
}

function sourceFile(path: string) {
  return sourceFileExtensions.has(/\.[^.]+$/.exec(path)?.[0] ?? '')
}

export function pathExists(path: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const pathService = yield* Path.Path
    const root = yield* repoRoot()
    return yield* fs.exists(pathService.resolve(root, path))
  })
}

function listFilesAbsolute(directory: string): Effect.Effect<string[], unknown, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const entries = yield* fs.readDirectory(directory)
    const files: string[] = []

    for (const entry of entries) {
      if (ignoredDirectories.has(entry)) {
        continue
      }

      const absolute = path.join(directory, entry)
      const stat = yield* fs.stat(absolute)
      if (stat.type === 'Directory') {
        files.push(...yield* listFilesAbsolute(absolute))
        continue
      }

      if (stat.type === 'File') {
        files.push(absolute)
      }
    }

    return files
  })
}

export function filesUnder(directory: string) {
  return Effect.gen(function* () {
    const path = yield* Path.Path
    const root = yield* repoRoot()
    return yield* listFilesAbsolute(path.resolve(root, directory))
  })
}

export function sourceFilesUnder(directory: string) {
  return Effect.map(filesUnder(directory), (files) => files.filter(sourceFile))
}

export function importSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  const patterns = [
    /import\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /export\s+(?:type\s+)?[^'";]+?\s+from\s+['"]([^'"]+)['"]/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      specifiers.push(match[1]!)
    }
  }

  return specifiers
}

export function fileText(file: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* repoRoot()
    return yield* fs.readFileString(path.resolve(root, file))
  })
}

export function importsForFiles(files: readonly string[]) {
  return Effect.gen(function* () {
    const imports: ImportReference[] = []

    for (const file of files) {
      const source = yield* fileText(file)
      const relativeFile = yield* relativeToRepo(file)
      for (const specifier of importSpecifiers(source)) {
        imports.push({ file: relativeFile, specifier })
      }
    }

    return imports
  })
}

export function sourceImportsUnder(directory: string) {
  return Effect.flatMap(sourceFilesUnder(directory), importsForFiles)
}

function isObjectRecord(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isObjectRecord(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
}

export function packageJson(file: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* repoRoot()
    const value: unknown = JSON.parse(yield* fs.readFileString(path.resolve(root, file)))
    if (!isObjectRecord(value)) {
      return {}
    }

    const manifest: PackageManifest = {}
    if (isStringRecord(value.exports)) {
      manifest.exports = value.exports
    }
    if (isStringRecord(value.scripts)) {
      manifest.scripts = value.scripts
    }
    if (isStringRecord(value.dependencies)) {
      manifest.dependencies = value.dependencies
    }
    if (isStringRecord(value.devDependencies)) {
      manifest.devDependencies = value.devDependencies
    }
    return manifest
  })
}
