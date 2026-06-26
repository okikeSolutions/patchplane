import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  ArchitectureFileSystemLayer,
  filesUnder,
  fileText,
  importsForFiles,
  packageJson,
  pathExists,
  relativeToRepo,
  sourceFilesUnder,
  sourceImportsUnder,
} from './architecture-files'

describe('architecture boundaries', () => {
  it.effect('keeps packages/domain typed errors free of raw SDK/vendor imports', () =>
    Effect.gen(function* () {
      const forbidden = [
        /^@sentry\//,
        /^convex(?:\/|$)/,
        /^@convex-dev\//,
        /^@workos(?:\/|$)/,
        /^@workos-inc\//,
        /^@daytona\//,
        /^octokit(?:\/|$)/,
        /^@octokit\//,
        /^@earendil-works\//,
        /^alchemy(?:\/|$)/,
        /^@alchemy\.run\//,
        /^cloudflare(?:\/|$)/,
        /^@cloudflare\//,
        /^@tanstack\//,
        /^@patchplane\/core(?:\/|$)/,
        /^@patchplane\/plugins(?:\/|$)/,
        /^@patchplane\/backend(?:\/|$)/,
        /^vendor(?:\/|$)/,
      ]

      const violations = (yield* sourceImportsUnder('packages/domain'))
        .filter(({ specifier }) => forbidden.some((pattern) => pattern.test(specifier)))

      expect(violations).toEqual([])
    }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect('keeps packages/core free of vendor, app, and plugin imports', () =>
    Effect.gen(function* () {
      const forbidden = [
        /^@sentry\//,
        /^convex(?:\/|$)/,
        /^@convex-dev\//,
        /^@workos(?:\/|$)/,
        /^@workos-inc\//,
        /^@daytona\//,
        /^octokit(?:\/|$)/,
        /^@octokit\//,
        /^@earendil-works\//,
        /^alchemy(?:\/|$)/,
        /^@alchemy\.run\//,
        /^cloudflare(?:\/|$)/,
        /^@cloudflare\//,
        /^@tanstack\//,
        /^@patchplane\/plugins(?:\/|$)/,
        /^vendor(?:\/|$)/,
        /^\.\.\/\.\.\/vendor(?:\/|$)/,
        /^\.\.\/\.\.\/\.\.\/vendor(?:\/|$)/,
      ]

      const violations = (yield* sourceImportsUnder('packages/core'))
        .filter(({ specifier }) => forbidden.some((pattern) => pattern.test(specifier)))

      expect(violations).toEqual([])
    }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect('keeps runtime imports from vendor/ out of apps and packages', () =>
    Effect.gen(function* () {
      const imports = yield* importsForFiles([
        ...yield* sourceFilesUnder('apps'),
        ...yield* sourceFilesUnder('packages'),
      ])
      const violations = imports.filter(({ specifier }) =>
        specifier === 'vendor' ||
        specifier.startsWith('vendor/') ||
        specifier.includes('/vendor/')
      )

      expect(violations).toEqual([])
    }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect('keeps Convex imports inside backend, Convex plugin, and app read-model boundaries', () =>
    Effect.gen(function* () {
      const imports = yield* importsForFiles([
        ...yield* sourceFilesUnder('apps'),
        ...yield* sourceFilesUnder('packages'),
      ])
      const violations = imports.filter(({ file, specifier }) => {
        const convexImport = specifier === 'convex' ||
          specifier.startsWith('convex/') ||
          specifier.startsWith('@convex-dev/') ||
          specifier.startsWith('@patchplane/backend/convex') ||
          specifier.includes('/_generated/')

        if (!convexImport) {
          return false
        }

        return !(
          file.startsWith('packages/backend/convex/') ||
          file.startsWith('packages/plugins/src/convex/') ||
          file.startsWith('apps/client/') ||
          file.endsWith('.test.ts') ||
          file.endsWith('.test.tsx')
        )
      })

      expect(violations).toEqual([])
    }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect('keeps Sentry imports isolated to Sentry plugin and tests', () =>
    Effect.gen(function* () {
      const imports = yield* importsForFiles([
        ...yield* sourceFilesUnder('apps'),
        ...yield* sourceFilesUnder('packages'),
      ])
      const violations = imports.filter(({ file, specifier }) => {
        if (!specifier.startsWith('@sentry/')) {
          return false
        }
        return !(
          file.startsWith('packages/plugins/src/sentry/') ||
          file.endsWith('.test.ts') ||
          file.endsWith('.test.tsx')
        )
      })

      expect(violations).toEqual([])
    }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect('keeps the Sentry plugin dependent on core rather than domain', () =>
    Effect.gen(function* () {
      const sentryImports = yield* sourceImportsUnder('packages/plugins/src/sentry')
      const domainImports = sentryImports.filter(({ specifier }) => specifier.startsWith('@patchplane/domain'))
      const coreImports = sentryImports.filter(({ specifier }) => specifier.startsWith('@patchplane/core'))

      expect(domainImports).toEqual([])
      expect(coreImports.length).toBeGreaterThan(0)
    }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect('does not add ClickHouse or OpenTelemetry collector runtime configuration', () =>
    Effect.gen(function* () {
      const packageManifestPaths = [
        'package.json',
        'apps/client/package.json',
        'packages/backend/package.json',
        'packages/cli/package.json',
        'packages/core/package.json',
        'packages/domain/package.json',
        'packages/plugins/package.json',
      ]
      const packageManifests = yield* Effect.all(
        packageManifestPaths.map((path) =>
          Effect.map(packageJson(path), (manifest) => ({ path, manifest }))
        ),
      )

      const dependencyViolations = packageManifests.flatMap(({ path, manifest }) =>
        Object.keys({
          ...manifest.dependencies,
          ...manifest.devDependencies,
        }).filter((dependency) =>
          dependency.toLowerCase().includes('clickhouse') ||
          dependency.startsWith('@opentelemetry/') ||
          dependency === 'opentelemetry'
        ).map((dependency) => ({ file: path, dependency }))
      )

      const candidateConfigFiles = yield* filesUnder('.')
      const configNameViolations = yield* Effect.all(
        candidateConfigFiles.map((file) =>
          Effect.map(relativeToRepo(file), (relativeFile) => {
            if (!relativeFile.startsWith('apps/') && !relativeFile.startsWith('packages/')) {
              return undefined
            }
            const lower = relativeFile.toLowerCase()
            return lower.includes('clickhouse') ||
                lower.includes('otel-collector') ||
                lower.includes('opentelemetry-collector')
              ? relativeFile
              : undefined
          })
        ),
      ).pipe(Effect.map((files) => files.filter((file) => file !== undefined)))

      expect(dependencyViolations).toEqual([])
      expect(configNameViolations).toEqual([])
    }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect('keeps app core workflow entrypoints behind the managed Effect runtime', () =>
    Effect.gen(function* () {
      const effectServerFn = yield* fileText('apps/client/src/lib/effect-server-fn.ts')
      expect(effectServerFn).toContain("import('@/effect/runtime')")
      expect(effectServerFn).toContain('patchPlaneRuntime.runPromiseExit(program)')

      const githubWebhookRoute = yield* fileText('apps/client/src/routes/api/github/webhook.tsx')
      expect(githubWebhookRoute).toContain("import('@/effect/runtime')")
      expect(githubWebhookRoute).toContain('patchPlaneRuntime.runPromiseExit(program)')

      const startWorkflow = yield* fileText('apps/client/src/lib/start-workflow.ts')
      expect(startWorkflow).toContain('effectServerFn({')
      expect(startWorkflow).not.toContain('createServerFn')

      const directCoreWorkflowImports = (yield* sourceImportsUnder('apps/client/src'))
        .filter(({ file, specifier }) =>
          specifier.startsWith('@patchplane/core/workflows/') &&
          !(
            file === 'apps/client/src/lib/start-workflow.ts' ||
            file === 'apps/client/src/routes/api/github/webhook.tsx' ||
            file === 'apps/client/src/scripts/smoke-workflow.ts'
          )
        )

      expect(directCoreWorkflowImports).toEqual([])
    }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect('keeps expected package directories, scripts, and public exports present', () =>
    Effect.gen(function* () {
      const expectedDirectories = [
        'packages/domain',
        'packages/core',
        'packages/plugins',
        'packages/backend/convex',
        'packages/cli',
        'apps/client',
      ]

      for (const directory of expectedDirectories) {
        expect(yield* pathExists(directory), directory).toBe(true)
      }

      const root = yield* packageJson('package.json')
      expect(root.scripts?.typecheck).toContain('packages/core')
      expect(root.scripts?.lint).toContain('oxlint apps packages')

      const core = yield* packageJson('packages/core/package.json')
      expect(Object.keys(core.exports ?? {})).toEqual(expect.arrayContaining([
        './services/telemetry-service',
        './services/artifacts-service',
        './services/model-gateway-service',
        './workflows/start-workflow-from-intake',
      ]))
      expect(core.scripts?.typecheck).toBeTruthy()
      expect(core.scripts?.test).toBeTruthy()

      const plugins = yield* packageJson('packages/plugins/package.json')
      expect(Object.keys(plugins.exports ?? {})).toEqual(expect.arrayContaining([
        './observability/local-plugin',
        './sentry/config',
        './sentry/telemetry-plugin',
        './github/provider-plugin',
        './daytona/sandbox-plugin',
        './pi/runtime-plugin',
      ]))
      expect(plugins.scripts?.typecheck).toBeTruthy()
      expect(plugins.scripts?.test).toBeTruthy()
    }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )
})
