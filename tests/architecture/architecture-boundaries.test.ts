import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import * as ts from 'typescript'
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

function directObservabilityCalls(file: string, source: string) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const names = new Set([
    'captureException',
    'captureEvent',
    'captureMessage',
    'addBreadcrumb',
    'identify',
    'capture',
    'track',
  ])
  const calls: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression
      const name =
        ts.isPropertyAccessExpression(expression) ||
        ts.isPropertyAccessChain(expression)
          ? expression.name.text
          : ts.isIdentifier(expression)
            ? expression.text
            : undefined
      if (name !== undefined && names.has(name)) {
        calls.push(`${file}:${name}`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return calls
}

describe('architecture boundaries', () => {
  it.effect(
    'keeps packages/domain typed errors free of raw SDK/vendor imports',
    () =>
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

        const violations = (yield* sourceImportsUnder(
          'packages/domain',
        )).filter(({ specifier }) =>
          forbidden.some((pattern) => pattern.test(specifier)),
        )

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

      const violations = (yield* sourceImportsUnder('packages/core')).filter(
        ({ specifier }) => forbidden.some((pattern) => pattern.test(specifier)),
      )

      expect(violations).toEqual([])
    }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect('keeps runtime imports from vendor/ out of apps and packages', () =>
    Effect.gen(function* () {
      const imports = yield* importsForFiles([
        ...(yield* sourceFilesUnder('apps')),
        ...(yield* sourceFilesUnder('packages')),
      ])
      const violations = imports.filter(
        ({ specifier }) =>
          specifier === 'vendor' ||
          specifier.startsWith('vendor/') ||
          specifier.includes('/vendor/'),
      )

      expect(violations).toEqual([])
    }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect(
    'keeps agent runtime packages out of trusted control-plane dependencies',
    () =>
      Effect.gen(function* () {
        const packageManifestPaths = [
          'package.json',
          'apps/client/package.json',
          'apps/source-control/package.json',
          'packages/backend/package.json',
          'packages/cli/package.json',
          'packages/core/package.json',
          'packages/domain/package.json',
          'packages/plugins/package.json',
        ]
        const forbidden = new Set([
          '@earendil-works/pi-coding-agent',
          '@earendil-works/pi-ai',
        ])

        const packageManifests = yield* Effect.all(
          packageManifestPaths.map((path) =>
            Effect.map(packageJson(path), (manifest) => ({ path, manifest })),
          ),
        )

        const violations = packageManifests.flatMap(({ path, manifest }) =>
          Object.keys({
            ...manifest.dependencies,
            ...manifest.devDependencies,
            ...manifest.optionalDependencies,
            ...manifest.peerDependencies,
          })
            .filter((dependency) => forbidden.has(dependency))
            .map((dependency) => ({ file: path, dependency })),
        )

        expect(violations).toEqual([])
      }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect('keeps Oxlint rules enabled across repository-owned source', () =>
    Effect.gen(function* () {
      const suppressionMarker = ['oxlint', 'disable'].join('-')
      const sourceFiles = (yield* filesUnder('.')).filter((file) =>
        /\.(?:[cm]?[jt]sx?)$/.test(file),
      )
      const violations = (yield* Effect.all(
        sourceFiles.map((file) =>
          Effect.gen(function* () {
            const source = yield* fileText(file)
            return source.includes(suppressionMarker)
              ? yield* relativeToRepo(file)
              : undefined
          }),
        ),
      )).filter((file) => file !== undefined)

      expect(violations).toEqual([])
    }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect(
    'uses Effect TypeScript-Go, TypeScript 7, and keeps Bun platform support at the Alchemy boundary',
    () =>
      Effect.gen(function* () {
        const packageManifestPaths = [
          'package.json',
          'apps/client/package.json',
          'apps/infra/package.json',
          'apps/source-control/package.json',
          'packages/backend/package.json',
          'packages/cli/package.json',
          'packages/core/package.json',
          'packages/domain/package.json',
          'packages/plugins/package.json',
        ]
        const packageManifests = yield* Effect.all(
          packageManifestPaths.map((path) =>
            Effect.map(packageJson(path), (manifest) => ({ path, manifest })),
          ),
        )

        const root = packageManifests.find(
          ({ path }) => path === 'package.json',
        )?.manifest
        expect(root?.scripts?.prepare).toBe('effect-tsgo patch')
        expect(root?.devDependencies?.['@effect/tsgo']).toBe('0.24.3')
        expect(root?.devDependencies?.['@typescript/native']).toBe(
          'npm:typescript@7.0.2',
        )
        // TypeScript ESLint and Paraglide still require the JavaScript compiler API.
        // Keep TS 6 only as that compatibility API; the `tsc` binary is TS 7.
        expect(root?.devDependencies?.typescript).toBe('6.0.3')
        expect(
          root?.devDependencies?.['@effect/language-service'],
        ).toBeUndefined()
        expect(root?.devDependencies?.['oxlint-tsgolint']).toBeUndefined()

        const workspaceTypescriptDependencies = packageManifests
          .filter(({ path }) => path !== 'package.json')
          .flatMap(({ path, manifest }) =>
            Object.keys({
              ...manifest.dependencies,
              ...manifest.devDependencies,
            })
              .filter(
                (dependency) =>
                  dependency === 'typescript' ||
                  dependency === '@typescript/native',
              )
              .map((dependency) => ({ path, dependency })),
          )
        expect(workspaceTypescriptDependencies).toEqual([])

        const platformBunDependencies = packageManifests.flatMap(
          ({ path, manifest }) =>
            Object.keys({
              ...manifest.dependencies,
              ...manifest.devDependencies,
              ...manifest.optionalDependencies,
              ...manifest.peerDependencies,
            })
              .filter((dependency) => dependency === '@effect/platform-bun')
              .map((dependency) => ({ path, dependency })),
        )
        const importViolations = (yield* importsForFiles([
          ...(yield* sourceFilesUnder('apps')),
          ...(yield* sourceFilesUnder('packages')),
          ...(yield* sourceFilesUnder('scripts')),
        ])).filter(
          ({ specifier }) =>
            specifier === '@effect/platform-bun' ||
            specifier.startsWith('@effect/platform-bun/'),
        )

        expect(platformBunDependencies).toEqual([
          { path: 'package.json', dependency: '@effect/platform-bun' },
        ])
        expect(importViolations).toEqual([])
        expect(
          packageManifests.some(
            ({ manifest }) =>
              Object.hasOwn(
                manifest.dependencies ?? {},
                '@effect/platform-node',
              ) ||
              Object.hasOwn(
                manifest.devDependencies ?? {},
                '@effect/platform-node',
              ),
          ),
        ).toBe(true)
      }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect('keeps Alchemy provisioning isolated to apps/infra', () =>
    Effect.gen(function* () {
      const imports = yield* importsForFiles([
        ...(yield* sourceFilesUnder('apps')),
        ...(yield* sourceFilesUnder('packages')),
      ])
      const violations = imports.filter(({ file, specifier }) => {
        const alchemyOrCloudflareProvisioningImport =
          specifier === 'alchemy' ||
          (specifier.startsWith('alchemy/') &&
            specifier !== 'alchemy/Cloudflare/Bridge') ||
          specifier === 'cloudflare' ||
          specifier.startsWith('cloudflare/') ||
          specifier.startsWith('@cloudflare/')

        if (!alchemyOrCloudflareProvisioningImport) {
          return false
        }

        return !file.startsWith('apps/infra/')
      })

      expect(violations).toEqual([])
    }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect(
    'keeps provider SDK implementations out of application source',
    () =>
      Effect.gen(function* () {
        const imports = yield* importsForFiles([
          ...(yield* sourceFilesUnder('apps')),
          ...(yield* sourceFilesUnder('packages')),
        ])
        const violations = imports.filter(
          ({ file, specifier }) =>
            (specifier.startsWith('@aws-sdk/') ||
              specifier.startsWith('@daytona/')) &&
            !file.startsWith('packages/plugins/') &&
            !file.startsWith('apps/infra/') &&
            !file.endsWith('.test.ts') &&
            !file.endsWith('.test.tsx'),
        )

        expect(violations).toEqual([])
      }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect(
    'keeps Convex imports inside backend, Convex plugin, and app read-model boundaries',
    () =>
      Effect.gen(function* () {
        const imports = yield* importsForFiles([
          ...(yield* sourceFilesUnder('apps')),
          ...(yield* sourceFilesUnder('packages')),
        ])
        const violations = imports.filter(({ file, specifier }) => {
          const convexImport =
            specifier === 'convex' ||
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
            file.startsWith('apps/source-control/') ||
            file.endsWith('.test.ts') ||
            file.endsWith('.test.tsx')
          )
        })

        const directHttpClientViolations = imports.filter(
          ({ file, specifier }) =>
            specifier === 'convex/browser' &&
            ![
              'packages/plugins/src/convex/http-client.ts',
              'packages/plugins/src/convex/native-deadline-mutation.ts',
            ].includes(file) &&
            !file.includes('/scripts/') &&
            !file.endsWith('.test.ts') &&
            !file.endsWith('.test.tsx'),
        )

        expect(violations).toEqual([])
        expect(directHttpClientViolations).toEqual([])
      }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect(
    'keeps Sentry imports isolated to Sentry plugin, client integration, and tests',
    () =>
      Effect.gen(function* () {
        const imports = yield* importsForFiles([
          ...(yield* sourceFilesUnder('apps')),
          ...(yield* sourceFilesUnder('packages')),
        ])
        const violations = imports.filter(({ file, specifier }) => {
          if (!specifier.startsWith('@sentry/')) {
            return false
          }
          return !(
            file.startsWith('packages/plugins/src/sentry/') ||
            (file.startsWith('apps/client/') &&
              (specifier === '@sentry/react' ||
                specifier === '@sentry/core')) ||
            file.endsWith('.test.ts') ||
            file.endsWith('.test.tsx')
          )
        })

        const effectRuntimeTargetViolations = imports.filter(
          ({ file, specifier }) =>
            file.startsWith('packages/plugins/src/sentry/') &&
            !file.endsWith('.test.ts') &&
            (specifier === '@sentry/effect' ||
              specifier === '@sentry/effect/client'),
        )

        expect(violations).toEqual([])
        expect(effectRuntimeTargetViolations).toEqual([])
      }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect('keeps product analytics SDKs behind plugin boundaries', () =>
    Effect.gen(function* () {
      const imports = yield* importsForFiles([
        ...(yield* sourceFilesUnder('apps')),
        ...(yield* sourceFilesUnder('packages')),
      ])
      const analyticsSdkPattern =
        /^(?:@posthog\/|posthog(?:-js|-node)?(?:\/|$)|@amplitude\/|mixpanel(?:-browser)?(?:\/|$)|@segment\/)/
      const violations = imports.filter(
        ({ file, specifier }) =>
          analyticsSdkPattern.test(specifier) &&
          !file.startsWith('packages/plugins/src/analytics/') &&
          !file.endsWith('.test.ts') &&
          !file.endsWith('.test.tsx'),
      )

      expect(violations).toEqual([])
    }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect(
    'keeps candidate diff content and paths out of direct telemetry and analytics calls',
    () =>
      Effect.gen(function* () {
        const diffSurfaceFiles = (yield* sourceFilesUnder(
          'apps/client/src',
        )).filter((file) =>
          /\/(?:candidate-(?:changed-files|diff|file|unified)[^/]*|use-candidate-diff-preview|workflow-changes)(?:\.test)?\.tsx?$/.test(
            file,
          ),
        )
        const imports = yield* importsForFiles(diffSurfaceFiles)
        const forbiddenImportPattern =
          /(?:^@sentry\/|posthog|analytics-service|telemetry-service)/
        const importViolations = imports.filter(({ specifier }) =>
          forbiddenImportPattern.test(specifier),
        )
        const directCallViolations = (yield* Effect.all(
          diffSurfaceFiles.map((file) =>
            Effect.gen(function* () {
              const source = yield* fileText(file)
              return directObservabilityCalls(
                yield* relativeToRepo(file),
                source,
              )
            }),
          ),
        )).flat()

        expect(diffSurfaceFiles.length).toBeGreaterThan(0)
        expect(importViolations).toEqual([])
        expect(directCallViolations).toEqual([])
      }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect(
    'keeps the Sentry plugin dependent on core rather than domain',
    () =>
      Effect.gen(function* () {
        const sentryImports = yield* sourceImportsUnder(
          'packages/plugins/src/sentry',
        )
        const domainImports = sentryImports.filter(({ specifier }) =>
          specifier.startsWith('@patchplane/domain'),
        )
        const coreImports = sentryImports.filter(({ specifier }) =>
          specifier.startsWith('@patchplane/core'),
        )

        expect(domainImports).toEqual([])
        expect(coreImports.length).toBeGreaterThan(0)
      }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect(
    'does not add ClickHouse or OpenTelemetry collector runtime configuration',
    () =>
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
            Effect.map(packageJson(path), (manifest) => ({ path, manifest })),
          ),
        )

        const dependencyViolations = packageManifests.flatMap(
          ({ path, manifest }) =>
            Object.keys({
              ...manifest.dependencies,
              ...manifest.devDependencies,
            })
              .filter(
                (dependency) =>
                  dependency.toLowerCase().includes('clickhouse') ||
                  dependency.startsWith('@opentelemetry/') ||
                  dependency === 'opentelemetry',
              )
              .map((dependency) => ({ file: path, dependency })),
        )

        const candidateConfigFiles = yield* filesUnder('.')
        const configNameViolations = yield* Effect.all(
          candidateConfigFiles.map((file) =>
            Effect.map(relativeToRepo(file), (relativeFile) => {
              if (
                !relativeFile.startsWith('apps/') &&
                !relativeFile.startsWith('packages/')
              ) {
                return undefined
              }
              const lower = relativeFile.toLowerCase()
              return lower.includes('clickhouse') ||
                lower.includes('otel-collector') ||
                lower.includes('opentelemetry-collector')
                ? relativeFile
                : undefined
            }),
          ),
        ).pipe(
          Effect.map((files) => files.filter((file) => file !== undefined)),
        )

        expect(dependencyViolations).toEqual([])
        expect(configNameViolations).toEqual([])
      }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect('keeps core workflow imports behind owned adapters', () =>
    Effect.gen(function* () {
      const directCoreWorkflowImports = (yield* sourceImportsUnder(
        'apps/client/src',
      )).filter(
        ({ file, specifier }) =>
          specifier.startsWith('@patchplane/core/workflows/') &&
          !(
            file === 'apps/client/src/lib/start-workflow.ts' ||
            file === 'apps/client/src/routes/api/github/webhook.tsx' ||
            file === 'apps/client/src/scripts/smoke-workflow.ts'
          ),
      )

      expect(directCoreWorkflowImports).toEqual([])
    }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect('keeps heavy diff renderers within their adapter modules', () =>
    Effect.gen(function* () {
      const imports = yield* sourceImportsUnder('apps/client/src')
      const owners = new Map([
        [
          '@pierre/diffs',
          'apps/client/src/components/app-shell/candidate-unified-diff.tsx',
        ],
        [
          '@pierre/trees',
          'apps/client/src/components/app-shell/candidate-changed-files-navigator.tsx',
        ],
      ])
      const violations = imports.filter(({ file, specifier }) => {
        for (const [packageName, owner] of owners) {
          if (
            (specifier === packageName ||
              specifier.startsWith(`${packageName}/`)) &&
            file !== owner
          ) {
            return true
          }
        }
        return false
      })

      expect(violations).toEqual([])
    }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect(
    'keeps Pi agent runtimes out of the web/control-plane composition',
    () =>
      Effect.gen(function* () {
        const appImports = yield* importsForFiles(
          yield* sourceFilesUnder('apps/client/src'),
        )
        const violations = appImports.filter(
          ({ specifier }) =>
            specifier === '@patchplane/plugins/pi/runtime-plugin' ||
            specifier === '@earendil-works/pi-coding-agent' ||
            specifier === '@earendil-works/pi-ai' ||
            specifier.startsWith('@earendil-works/pi-coding-agent/') ||
            specifier.startsWith('@earendil-works/pi-ai/'),
        )

        expect(violations).toEqual([])
      }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect(
    'keeps expected package directories, scripts, and public exports present',
    () =>
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
        expect(root.scripts?.typecheck).toBe(
          'bun run --workspaces --if-present typecheck',
        )
        expect(root.scripts?.lint).toContain('oxlint --disable-nested-config')

        const core = yield* packageJson('packages/core/package.json')
        expect(Object.keys(core.exports ?? {})).toEqual(
          expect.arrayContaining([
            './services/telemetry-service',
            './services/artifacts-service',
            './services/storage-service',
            './workflows/start-workflow-from-intake',
          ]),
        )
        expect(core.scripts?.typecheck).toBeTruthy()
        expect(core.scripts?.test).toBeTruthy()

        const plugins = yield* packageJson('packages/plugins/package.json')
        expect(Object.keys(plugins.exports ?? {})).toEqual(
          expect.arrayContaining([
            './observability/local-plugin',
            './sentry/config',
            './sentry/telemetry-plugin',
            './github/provider-plugin',
            './daytona/sandbox-plugin',
          ]),
        )
        expect(Object.keys(plugins.exports ?? {})).not.toContain('./pi/config')
        expect(plugins.scripts?.typecheck).toBeTruthy()
        expect(plugins.scripts?.test).toBeTruthy()
      }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )
})
