import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { parseSync } from 'oxc-parser'

const IGNORED_DIRS = new Set([
  '.git',
  '.alchemy',
  'dist',
  'node_modules',
  'fixtures',
])

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])

export const REPO_ROOT = resolve(import.meta.dirname, '../..')

export function toPosix(filePath: string): string {
  return filePath.split('\\').join('/')
}

export function relativeToRepo(absolutePath: string): string {
  return toPosix(relative(REPO_ROOT, absolutePath))
}

export function readRepoFile(repoRelativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, repoRelativePath), 'utf8')
}

export function listSourceFiles(directory: string): ReadonlyArray<string> {
  const start = resolve(REPO_ROOT, directory)
  const results: string[] = []

  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      if (IGNORED_DIRS.has(entry)) continue
      const absolute = join(current, entry)
      const stat = statSync(absolute)
      if (stat.isDirectory()) {
        walk(absolute)
        continue
      }
      if (!stat.isFile()) continue
      const dot = entry.lastIndexOf('.')
      if (dot !== -1 && SOURCE_EXTENSIONS.has(entry.slice(dot))) {
        results.push(relativeToRepo(absolute))
      }
    }
  }

  walk(start)
  return results.toSorted()
}

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
