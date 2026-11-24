import { describe, expect, it } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import {
  ArchitecturePlatformLayer,
  extractImportSpecifiers,
  isProductionSourceFile,
  listSourceFiles,
  parseAst,
  readRepoFile,
} from './architecture-files'

const PackageManifestSchema = Schema.fromJsonString(
  Schema.Struct({
    name: Schema.String,
    dependencies: Schema.optionalKey(
      Schema.Record(Schema.String, Schema.String),
    ),
    devDependencies: Schema.optionalKey(
      Schema.Record(Schema.String, Schema.String),
    ),
  }),
)

const readManifest = (path: string) =>
  Effect.gen(function* () {
    const content = yield* readRepoFile(path)
    return yield* Schema.decodeEffect(PackageManifestSchema)(content)
  })

const collectProductionImports = (directory: string) =>
  Effect.gen(function* () {
    const files = (yield* listSourceFiles(directory)).filter(
      isProductionSourceFile,
    )
    const results: Array<{
      readonly file: string
      readonly specifier: string
    }> = []
    for (const file of files) {
      const source = yield* readRepoFile(file)
      for (const specifier of extractImportSpecifiers(file, source)) {
        results.push({ file, specifier })
      }
    }
    return results
  })

describe('V2 architecture boundaries', () => {
  it.effect('keeps packages/domain restricted to Effect only', () =>
    Effect.gen(function* () {
      const imports = yield* collectProductionImports('packages/domain/src')
      const violations = imports.filter(
        ({ specifier }) =>
          !specifier.startsWith('.') &&
          specifier !== 'effect' &&
          !specifier.startsWith('effect/'),
      )
      expect(violations).toEqual([])
    }).pipe(Effect.provide(ArchitecturePlatformLayer)),
  )

  it.effect(
    'keeps packages/contracts restricted to Effect and @patchplane/domain',
    () =>
      Effect.gen(function* () {
        const imports = yield* collectProductionImports(
          'packages/contracts/src',
        )
        const violations = imports.filter(
          ({ specifier }) =>
            !specifier.startsWith('.') &&
            specifier !== 'effect' &&
            !specifier.startsWith('effect/') &&
            specifier !== '@patchplane/domain',
        )
        expect(violations).toEqual([])
      }).pipe(Effect.provide(ArchitecturePlatformLayer)),
  )

  it.effect(
    'keeps packages/core free of provider SDKs, plugins, and apps',
    () =>
      Effect.gen(function* () {
        const imports = yield* collectProductionImports('packages/core/src')
        const allowedExternal = new Set([
          '@patchplane/domain',
          '@patchplane/contracts',
        ])
        const violations = imports.filter(
          ({ specifier }) =>
            !specifier.startsWith('.') &&
            specifier !== 'effect' &&
            !specifier.startsWith('effect/') &&
            !allowedExternal.has(specifier),
        )
        expect(violations).toEqual([])
      }).pipe(Effect.provide(ArchitecturePlatformLayer)),
  )

  it.effect(
    'keeps apps/web free of backend plugins, server, infra, and provider SDKs',
    () =>
      Effect.gen(function* () {
        const forbidden = [
          /^@patchplane\/plugins(?:\/|$)/,
          /^@patchplane\/core(?:\/|$)/,
          /^@patchplane\/server(?:\/|$)/,
          /^@patchplane\/infra(?:\/|$)/,
          /^@effect\/sql-pg(?:\/|$)/,
          /^alchemy(?:\/|$)/,
          /^@alchemy\.run\//,
          /^@workos/,
          /^@octokit\//,
          /^octokit(?:\/|$)/,
          /^@daytona\//,
          /^@distilled\.cloud\//,
        ]
        const imports = yield* collectProductionImports('apps/web/src')
        const violations = imports.filter(({ specifier }) =>
          forbidden.some((pattern) => pattern.test(specifier)),
        )
        expect(violations).toEqual([])
      }).pipe(Effect.provide(ArchitecturePlatformLayer)),
  )

  it.effect(
    'isolates React to apps/web/src/islands and enforces a strict island import and global allowlist',
    () =>
      Effect.gen(function* () {
        const reactPattern = /^react(?:-dom)?(?:\/|$)/
        const allowedIslandExternals = new Set([
          'react',
          'react-dom',
          'react-dom/client',
          'diff',
          '@patchplane/contracts',
          '@patchplane/domain',
        ])
        const webImports = yield* collectProductionImports('apps/web/src')

        const leakedReact = webImports.filter(
          ({ file, specifier }) =>
            reactPattern.test(specifier) &&
            !file.startsWith('apps/web/src/islands/'),
        )
        expect(leakedReact).toEqual([])

        const islandImportViolations = webImports.filter(
          ({ file, specifier }) => {
            if (!file.startsWith('apps/web/src/islands/')) return false
            if (specifier.startsWith('./') && !specifier.includes('..')) {
              return false
            }
            return !allowedIslandExternals.has(specifier)
          },
        )
        expect(islandImportViolations).toEqual([])

        const forbiddenGlobals = new Set([
          'fetch',
          'EventSource',
          'WebSocket',
          'XMLHttpRequest',
          'sendBeacon',
        ])
        const islandFiles = (yield* listSourceFiles(
          'apps/web/src/islands',
        )).filter(isProductionSourceFile)
        const networkViolations: Array<{
          readonly file: string
          readonly identifier: string
        }> = []

        const visitAst = (file: string, node: unknown) => {
          if (typeof node !== 'object' || node === null) return
          if (Array.isArray(node)) {
            for (const item of node) visitAst(file, item)
            return
          }
          const type = Reflect.get(node, 'type')
          const name = Reflect.get(node, 'name')
          if (
            type === 'Identifier' &&
            typeof name === 'string' &&
            forbiddenGlobals.has(name)
          ) {
            networkViolations.push({ file, identifier: name })
          }
          for (const [key, value] of Object.entries(node)) {
            if (key === 'type' || key === 'start' || key === 'end') continue
            visitAst(file, value)
          }
        }

        for (const file of islandFiles) {
          const source = yield* readRepoFile(file)
          const { program } = parseAst(file, source)
          visitAst(file, program)
        }
        expect(networkViolations).toEqual([])
      }).pipe(Effect.provide(ArchitecturePlatformLayer)),
  )

  it.effect('keeps packages/cli free of plugins, server, web, and infra', () =>
    Effect.gen(function* () {
      const forbidden = [
        /^@patchplane\/plugins(?:\/|$)/,
        /^@patchplane\/server(?:\/|$)/,
        /^@patchplane\/web(?:\/|$)/,
        /^@patchplane\/infra(?:\/|$)/,
        /^alchemy(?:\/|$)/,
        /^@alchemy\.run\//,
      ]
      const imports = yield* collectProductionImports('packages/cli/src')
      const violations = imports.filter(({ specifier }) =>
        forbidden.some((pattern) => pattern.test(specifier)),
      )
      expect(violations).toEqual([])
    }).pipe(Effect.provide(ArchitecturePlatformLayer)),
  )

  it.effect('keeps apps/infra out of every runtime package and app', () =>
    Effect.gen(function* () {
      const runtimeDirs = [
        'packages/domain/src',
        'packages/contracts/src',
        'packages/core/src',
        'packages/plugins/src',
        'packages/cli/src',
        'apps/server/src',
        'apps/web/src',
      ]
      const allImports = (yield* Effect.forEach(runtimeDirs, (dir) =>
        collectProductionImports(dir),
      )).flat()
      const violations = allImports.filter(
        ({ specifier }) =>
          specifier === '@patchplane/infra' ||
          specifier.startsWith('@patchplane/infra/') ||
          specifier.includes('/apps/infra/'),
      )
      expect(violations).toEqual([])
    }).pipe(Effect.provide(ArchitecturePlatformLayer)),
  )

  it.effect(
    'uses Effect crypto, FileSystem, and Path instead of node:crypto, node:fs, and node:path across packages and apps',
    () =>
      Effect.gen(function* () {
        const forbidden = new Set([
          'node:crypto',
          'crypto',
          'node:fs',
          'node:fs/promises',
          'fs',
          'fs/promises',
          'node:path',
          'node:path/posix',
          'node:path/win32',
          'path',
        ])
        const allImports = (yield* Effect.forEach(['packages', 'apps'], (dir) =>
          collectProductionImports(dir),
        )).flat()
        const violations = allImports.filter(({ specifier }) =>
          forbidden.has(specifier),
        )
        expect(violations).toEqual([])
      }).pipe(Effect.provide(ArchitecturePlatformLayer)),
  )

  it.effect(
    'forbids personal-device SimLock dependencies and keeps cloud Android verification provider-neutral in core',
    () =>
      Effect.gen(function* () {
        const forbiddenEverywhere = [
          /personal[-_]?simlock/i,
          /local[-_]?simlock/i,
          /firebase-test-lab/i,
        ]
        const allImports = (yield* Effect.forEach(['packages', 'apps'], (dir) =>
          collectProductionImports(dir),
        )).flat()
        const personalDeviceViolations = allImports.filter(({ specifier }) =>
          forbiddenEverywhere.some((pattern) => pattern.test(specifier)),
        )
        expect(personalDeviceViolations).toEqual([])

        const coreFiles = (yield* listSourceFiles('packages/core/src')).filter(
          isProductionSourceFile,
        )
        const githubCouplingViolations: Array<string> = []
        for (const file of coreFiles) {
          const source = yield* readRepoFile(file)
          if (
            /github-actions-kvm|octokit|workflow_dispatch|x-hub-signature|@workos/i.test(
              source,
            )
          ) {
            githubCouplingViolations.push(file)
          }
        }
        expect(githubCouplingViolations).toEqual([])
      }).pipe(Effect.provide(ArchitecturePlatformLayer)),
  )

  it.effect('keeps removed V1 frameworks out of workspace manifests', () =>
    Effect.gen(function* () {
      const manifests = [
        'package.json',
        'packages/domain/package.json',
        'packages/contracts/package.json',
        'packages/core/package.json',
        'packages/plugins/package.json',
        'packages/cli/package.json',
        'apps/server/package.json',
        'apps/web/package.json',
        'apps/infra/package.json',
      ]
      const forbidden = [
        /^convex(?:\/|$)/,
        /^@convex-dev\//,
        /^@tanstack\//,
        /^@earendil-works\//,
        /^@effect\/sql-d1$/,
      ]
      const violations: Array<{ readonly file: string; readonly dep: string }> =
        []
      for (const file of manifests) {
        const manifest = yield* readManifest(file)
        const deps = [
          ...Object.keys(manifest.dependencies ?? {}),
          ...Object.keys(manifest.devDependencies ?? {}),
        ]
        for (const dep of deps) {
          if (forbidden.some((pattern) => pattern.test(dep))) {
            violations.push({ file, dep })
          }
        }
      }
      expect(violations).toEqual([])
    }).pipe(Effect.provide(ArchitecturePlatformLayer)),
  )
})
