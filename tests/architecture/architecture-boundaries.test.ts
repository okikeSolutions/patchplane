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

        const lockfile = yield* fileText('bun.lock')
        const bundleBudgetScript = yield* fileText(
          'scripts/bundle-size-client.ts',
        )

        expect(platformBunDependencies).toEqual([
          { path: 'package.json', dependency: '@effect/platform-bun' },
        ])
        expect(importViolations).toEqual([])
        expect(lockfile).toContain('"@effect/platform-bun": [')
        expect(bundleBudgetScript).toContain(
          '@effect/platform-node/NodeServices',
        )
        expect(bundleBudgetScript).not.toContain('@effect/platform-bun')
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

        expect(violations).toEqual([])
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
              specifier.startsWith('@sentry/tanstackstart-react')) ||
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
        const directTransportPattern =
          /\b(?:captureException|captureEvent|captureMessage|addBreadcrumb|identify)\s*\(|\.(?:capture|track)\s*\(/
        const directCallViolations = (yield* Effect.all(
          diffSurfaceFiles.map((file) =>
            Effect.gen(function* () {
              const source = yield* fileText(file)
              return directTransportPattern.test(source)
                ? yield* relativeToRepo(file)
                : undefined
            }),
          ),
        )).filter((file) => file !== undefined)

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

  it.effect(
    'keeps app core workflow entrypoints behind the managed Effect runtime',
    () =>
      Effect.gen(function* () {
        const effectServerFn = yield* fileText(
          'apps/client/src/lib/effect-server-fn.ts',
        )
        expect(effectServerFn).toContain("import('@/effect/runtime')")
        expect(effectServerFn).toContain(
          'patchPlaneRuntime.runPromiseExit(program)',
        )

        const githubWebhookRoute = yield* fileText(
          'apps/client/src/routes/api/github/webhook.tsx',
        )
        expect(githubWebhookRoute).toContain('dedicated GitHubWebhookWorker')
        expect(githubWebhookRoute).not.toContain(
          "import('@/effect/webhook-runtime')",
        )
        expect(githubWebhookRoute).not.toContain(
          'patchPlaneRuntime.runPromiseExit(program)',
        )

        const startWorkflow = yield* fileText(
          'apps/client/src/lib/start-workflow.ts',
        )
        expect(startWorkflow).toContain('effectServerFn({')
        expect(startWorkflow).not.toContain('createServerFn')

        const runtimeControl = yield* fileText(
          'apps/client/src/lib/control-runtime-session.ts',
        )
        expect(runtimeControl).toContain('effectServerFn({')
        expect(runtimeControl).toContain('authorizeRuntimeControl')
        expect(runtimeControl).toContain('/internal/runtime/control')
        expect(runtimeControl).not.toContain('DaytonaSandboxPlugin')
        expect(runtimeControl).not.toContain('SandboxService')
        expect(runtimeControl).not.toContain('sandboxId')
        expect(runtimeControl).not.toContain('sessionId')
        expect(runtimeControl).not.toContain('commandId')

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

  it.effect(
    'keeps hosted GitHub install and webhook routes wired across client and source-control Workers',
    () =>
      Effect.gen(function* () {
        const clientCallback = yield* fileText(
          'apps/client/src/routes/api/github/install/callback.tsx',
        )
        const clientWebhook = yield* fileText(
          'apps/client/src/routes/api/github/webhook.tsx',
        )
        const sourceControlWorker = yield* fileText(
          'apps/source-control/src/worker.ts',
        )
        const githubWebhookWorker = yield* fileText(
          'apps/source-control/src/webhook-worker.ts',
        )
        const sourceControlGitHubRoutes = yield* fileText(
          'apps/source-control/src/github/routes.ts',
        )
        const infra = yield* fileText('alchemy.run.ts')

        expect(clientCallback).toContain('getSourceControlWorker')
        expect(clientCallback).toContain('Cloudflare.fromCloudflareFetcher')
        expect(clientCallback).toContain(
          'https://source-control-worker/internal/github/install/sync',
        )
        expect(clientCallback).toContain('HttpClientRequest.post')
        expect(clientCallback).not.toContain('internalWorkerToken')

        expect(sourceControlWorker).toContain(
          "url.pathname === '/internal/github/install/sync'",
        )
        expect(sourceControlWorker).toContain(
          'syncGitHubInstallation(request, runtime)',
        )
        expect(sourceControlWorker).toContain(
          "url.pathname === '/api/github/webhook'",
        )
        expect(sourceControlWorker).toContain(
          'handleGitHubWebhook(request, env, runtime)',
        )
        expect(sourceControlWorker).toContain(
          "url.pathname === '/internal/runtime/control'",
        )
        expect(sourceControlWorker).toContain(
          'controlRuntimeSession(request, runtime)',
        )
        expect(sourceControlWorker).toContain('withCloudflareSentry({')
        expect(githubWebhookWorker).toContain('withCloudflareSentry({')

        expect(sourceControlGitHubRoutes).toContain(
          'export async function syncGitHubInstallation',
        )
        expect(sourceControlGitHubRoutes).toContain(
          'export async function handleGitHubWebhook',
        )
        expect(sourceControlGitHubRoutes).not.toContain(
          'assertInternalAuthorization(request)',
        )
        expect(sourceControlGitHubRoutes).toContain(
          'CloudflareTelemetryPlugin.layer',
        )
        expect(sourceControlGitHubRoutes).not.toContain(
          'SentryTelemetryPlugin.layer',
        )
        expect(sourceControlGitHubRoutes).toContain('ControlRuntimeSession')
        expect(sourceControlGitHubRoutes).toContain('StartWorkflowFromIntake')
        expect(sourceControlGitHubRoutes).toContain(
          'GitHubEventToWorkflowIntake',
        )
        expect(sourceControlGitHubRoutes).toContain(
          'RunSandboxAgentForWorkflow',
        )
        expect(sourceControlGitHubRoutes).toContain(
          'PublishSandboxResultToSource',
        )

        expect(clientWebhook).toContain(
          'GitHub webhooks are handled by the dedicated GitHubWebhookWorker',
        )
        expect(infra).toContain('SourceControlWorker')
        expect(infra).toContain('url: false')
        expect(infra).toContain('SOURCE_CONTROL_WORKER: sourceControlWorker')
        expect(infra).toContain(
          'CLOUDFLARE_SENTRY_DSN: sourceControlRuntimeEnv.CLOUDFLARE_SENTRY_DSN',
        )
      }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect('keeps app-shell feature UI composed from shared primitives', () =>
    Effect.gen(function* () {
      const featureFiles = (yield* sourceFilesUnder(
        'apps/client/src/components/app-shell',
      )).filter(
        (file) => !file.endsWith('.test.ts') && !file.endsWith('.test.tsx'),
      )
      const featureImports = yield* importsForFiles(featureFiles)
      const featureSources = yield* Effect.all(
        featureFiles.map((file) =>
          fileText(file).pipe(Effect.map((source) => ({ file, source }))),
        ),
      )
      const toolbar = yield* fileText(
        'apps/client/src/components/app-shell/workflow-console-toolbar.tsx',
      )
      const artifactReferences = yield* fileText(
        'apps/client/src/components/app-shell/workflow-artifact-references.tsx',
      )
      const reviewPanel = yield* fileText(
        'apps/client/src/components/app-shell/workflow-review-panel.tsx',
      )

      expect(
        featureImports.filter(
          ({ specifier }) =>
            specifier === 'sonner' ||
            specifier.startsWith('@base-ui/') ||
            specifier.startsWith('@radix-ui/'),
        ),
      ).toEqual([])

      const forbiddenMarkup =
        /<(?:button|input|textarea|select|option|table|thead|tbody|tr|th|td|hr)\b/
      expect(
        featureSources
          .filter(
            ({ source }) =>
              forbiddenMarkup.test(source) ||
              /\b(?:animate-pulse|space-x-|space-y-)/.test(source),
          )
          .map(({ file }) => file),
      ).toEqual([])

      expect(toolbar).toContain("from '@/components/ui/toggle-group'")
      expect(toolbar).toContain('<ToggleGroup')
      expect(toolbar).not.toContain('function FilterButton')
      expect(artifactReferences).toContain("from '@/components/ui/alert'")
      expect(artifactReferences).toContain("from '@/components/ui/item'")
      expect(artifactReferences).not.toContain('<Card')
      expect(reviewPanel).toContain("from '@/components/ui/item'")
      expect(reviewPanel).toContain('<ItemGroup')
    }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect(
    'keeps hosted artifact reads behind authorization and a native R2 binding',
    () =>
      Effect.gen(function* () {
        const artifactRoute = yield* fileText(
          'apps/client/src/routes/api/artifacts/url.tsx',
        )
        const clientEnv = yield* fileText('apps/client/src/env.ts')
        const infra = yield* fileText('alchemy.run.ts')

        expect(artifactRoute).toContain('getEvidenceArtifact')
        expect(artifactRoute).toContain('getEvidenceBucket')
        expect(artifactRoute).toContain('createArtifactStorageResponse')
        expect(artifactRoute).not.toContain('createR2SignedReadUrl')
        expect(artifactRoute).not.toContain('@aws-sdk/')
        expect(clientEnv).toContain('PATCHPLANE_EVIDENCE_BUCKET: R2Bucket')
        expect(infra).toContain('PATCHPLANE_EVIDENCE_BUCKET: evidenceBucket')
        expect(infra).not.toContain('PATCHPLANE_EVIDENCE_R2_ACCESS_KEY_ID')
        expect(infra).not.toContain('PATCHPLANE_EVIDENCE_R2_SECRET_ACCESS_KEY')
      }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect(
    'keeps diff rendering behind the authenticated PatchPlane artifact boundary',
    () =>
      Effect.gen(function* () {
        const artifactRoute = yield* fileText(
          'apps/client/src/routes/api/artifacts/url.tsx',
        )
        const workflowChanges = yield* fileText(
          'apps/client/src/components/app-shell/workflow-changes.tsx',
        )
        const diffPreviewHook = yield* fileText(
          'apps/client/src/components/app-shell/use-candidate-diff-preview.ts',
        )
        const diffRuntime = yield* fileText(
          'apps/client/src/effect/diff-runtime.ts',
        )
        const diffBenchmark = yield* fileText(
          'apps/client/src/scripts/diff-viewer-benchmark.ts',
        )
        const diffFixture = yield* fileText(
          'apps/client/test/performance/diff-viewer/main.tsx',
        )
        const rootManifest = yield* packageJson('package.json')
        const workflowDetailPage = yield* fileText(
          'apps/client/src/components/app-shell/workflow-detail-page.tsx',
        )
        const renderer = yield* fileText(
          'apps/client/src/components/app-shell/candidate-diff-renderer.tsx',
        )
        const rendererFailureBoundary = yield* fileText(
          'apps/client/src/components/app-shell/candidate-diff-failure-boundary.tsx',
        )
        const pierreRenderer = yield* fileText(
          'apps/client/src/components/app-shell/candidate-unified-diff.tsx',
        )
        const clientImports = yield* sourceImportsUnder('apps/client/src')
        const pierreDiffImports = clientImports.filter(
          ({ specifier }) =>
            specifier === '@pierre/diffs' ||
            specifier.startsWith('@pierre/diffs/'),
        )

        expect(artifactRoute).toContain("await import('@workos/authkit")
        expect(artifactRoute).toContain('convex.setAuth(input.accessToken)')
        expect(artifactRoute).toContain('getEvidenceBucket')
        expect(artifactRoute).toContain('createArtifactStorageResponse')
        expect(workflowChanges).toContain('<CandidateDiffRenderer')
        expect(workflowChanges).toContain('content={diffPreview.content}')
        expect(workflowChanges).toContain(
          'projection={diffPreview.changedFiles}',
        )
        expect(workflowChanges).toContain('useCandidateDiffPreview({')
        expect(diffPreviewHook).toContain("credentials: 'same-origin'")
        expect(diffPreviewHook).toContain("cache: 'no-store'")
        expect(diffPreviewHook).toContain(
          "await import('@/effect/diff-runtime')",
        )
        expect(diffPreviewHook).toContain('diffProjectionRuntime.runPromise(')
        expect(diffPreviewHook).not.toContain(
          "await import('@/effect/runtime')",
        )
        expect(diffRuntime).toContain('ManagedRuntime.make(Layer.empty')
        expect(diffRuntime).not.toContain('app-layer')
        expect(diffRuntime).not.toContain('@patchplane/plugins')
        expect(rootManifest.scripts?.['bench:diff-viewer']).toBe(
          'bun apps/client/src/scripts/diff-viewer-benchmark.ts',
        )
        expect(diffBenchmark).toContain("host: '127.0.0.1'")
        expect(diffBenchmark).toContain('largeInitialRenderMs: 6_000')
        expect(diffBenchmark).toContain('standardInitialRenderMs: 2_000')
        expect(diffBenchmark).toContain('fileSwitchMs: 100')
        expect(diffFixture).toContain('<CandidateDiffRenderer')
        expect(diffFixture).toContain('ProjectCandidateChangedFiles(content)')
        expect(diffFixture).not.toContain('fetch(')
        expect(workflowDetailPage).toContain("import('./workflow-changes')")
        expect(workflowDetailPage).toContain("activeTab === 'changes'")
        expect(workflowDetailPage).not.toContain(
          "import { WorkflowChanges } from './workflow-changes'",
        )

        expect(renderer).toContain('readonly content: string')
        expect(pierreRenderer).toContain(
          "import { PatchDiff } from '@pierre/diffs/react'",
        )
        expect(renderer).toContain('import.meta.env.SSR')
        expect(renderer).toContain("import('./candidate-unified-diff')")
        expect(renderer).toContain('CandidateDiffProcessorUnavailableError')
        expect(renderer).toContain('fallbackKind="malformed"')
        expect(renderer).toContain('fallbackKind="processor-unavailable"')
        expect(rendererFailureBoundary).toContain(
          "CandidateDiffRendererFailure = 'malformed' | 'processor-unavailable'",
        )
        expect(rendererFailureBoundary).toContain(
          "from '@/components/ui/alert'",
        )
        expect(rendererFailureBoundary).not.toContain('console.')
        expect(pierreRenderer).toContain('<PatchDiff')
        expect(pierreRenderer).toContain('diffStyle: view')
        expect(pierreRenderer).toContain('readonly view: WorkflowDiffView')
        expect(pierreRenderer).toContain("preferredHighlighter: 'shiki-js'")
        expect(pierreRenderer).toContain('disableWorkerPool')
        expect(pierreRenderer).not.toContain('new Worker')
        expect(pierreRenderer).not.toContain('workerUrl')
        expect(pierreRenderer).not.toContain("diffStyle: 'split'")
        for (const forbidden of [
          'artifactId',
          'artifactSha256',
          'artifactSizeBytes',
          'returnedBytes',
          'truncated',
          'workflowRunId',
          'fetch(',
          '/api/artifacts',
          'navigator.sendBeacon',
          'XMLHttpRequest',
          'WebSocket',
        ]) {
          expect(renderer).not.toContain(forbidden)
          expect(pierreRenderer).not.toContain(forbidden)
        }

        expect(
          pierreDiffImports.filter(
            ({ file }) =>
              file !==
              'apps/client/src/components/app-shell/candidate-unified-diff.tsx',
          ),
        ).toEqual([])
      }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect(
    'keeps changed-file projection candidate-bound and independent of repository trees',
    () =>
      Effect.gen(function* () {
        const projection = yield* fileText(
          'packages/core/src/diff/project-candidate-changed-files.ts',
        )
        const treeAdapter = yield* fileText(
          'apps/client/src/components/app-shell/candidate-changed-files-navigator.tsx',
        )
        const diffRenderer = yield* fileText(
          'apps/client/src/components/app-shell/candidate-diff-renderer.tsx',
        )
        const workflowChanges = yield* fileText(
          'apps/client/src/components/app-shell/workflow-changes.tsx',
        )
        const diffPreviewHook = yield* fileText(
          'apps/client/src/components/app-shell/use-candidate-diff-preview.ts',
        )
        const statistics = yield* fileText(
          'packages/core/src/diff/parse-unified-diff-stats.ts',
        )
        const clientFiles = yield* sourceFilesUnder('apps/client/src')
        const clientImports = yield* importsForFiles(clientFiles)
        const clientSources = yield* Effect.all(
          clientFiles.map((file) => fileText(file)),
        )
        const repositoryTreeMarkers = [
          '/git/trees',
          'git/trees?recursive',
          'repos.getContent',
          'getRepositoryTree',
        ]

        expect(projection).toContain(
          'export const ProjectCandidateChangedFiles = Effect.fn(',
        )
        expect(projection).toContain(
          "'@patchplane/core/diff/ProjectCandidateChangedFiles'",
        )
        expect(projection).toContain("from '@patchplane/domain/candidate-file'")
        expect(projection).toContain(
          'Schema.decodeUnknownOption(CandidateFilePath)',
        )
        expect(projection).toContain('Match.value(line).pipe(')
        expect(statistics).toContain(
          'export const ParseUnifiedDiffStats = Effect.fn(',
        )
        expect(statistics).toContain(
          "'@patchplane/core/diff/ParseUnifiedDiffStats'",
        )
        expect(statistics).toContain(
          'extends Schema.TaggedErrorClass<UnifiedDiffStatsUnavailable>()(',
        )
        expect(statistics).toContain(
          "import { Effect, Match, Schema } from 'effect'",
        )
        expect(statistics).toContain('Match.value(line).pipe(')
        expect(projection).toContain('content: string')
        expect(projection).not.toContain('fetch(')
        expect(projection).not.toContain('github')

        for (const source of clientSources) {
          for (const marker of repositoryTreeMarkers) {
            expect(source).not.toContain(marker)
          }
        }

        expect(treeAdapter).toContain("from '@pierre/trees/react'")
        expect(treeAdapter).toContain(
          "model.scrollToPath(path, { focus: true, offset: 'nearest' })",
        )
        expect(treeAdapter).not.toContain('.shadowRoot')
        expect(treeAdapter).not.toContain('MutationObserver')
        expect(diffRenderer).toContain(
          "lazy(() =>\n  import('./candidate-changed-files-navigator')",
        )
        expect(workflowChanges).toContain('useCandidateDiffPreview({')
        expect(diffPreviewHook).toContain('diffProjectionRuntime.runPromise(')
        expect(diffPreviewHook).not.toContain('Effect.runPromise')
        expect(
          clientImports.filter(
            ({ file, specifier }) =>
              (specifier === '@pierre/trees' ||
                specifier.startsWith('@pierre/trees/')) &&
              file !==
                'apps/client/src/components/app-shell/candidate-changed-files-navigator.tsx',
          ),
        ).toEqual([])
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
    'keeps sandbox control-plane credentials out of core sandbox inputs and Daytona env injection',
    () =>
      Effect.gen(function* () {
        const sandboxService = yield* fileText(
          'packages/core/src/services/sandbox-service.ts',
        )
        const daytonaPlugin = yield* fileText(
          'packages/plugins/src/daytona/DaytonaSandboxPlugin.ts',
        )
        const forbidden = [
          'workos',
          'convex',
          'systemIngestionSecret',
          'PATCHPLANE_SYSTEM_INGESTION_SECRET',
          'GITHUB_PRIVATE_KEY',
          'githubPrivateKey',
          'appPrivateKey',
          'WORKOS_API_KEY',
          'CONVEX_URL',
        ]

        for (const value of forbidden) {
          expect(sandboxService.toLowerCase()).not.toContain(
            value.toLowerCase(),
          )
        }

        expect(daytonaPlugin).toMatch(
          /piRuntimeEnvironment\(\{\s*provider: input\.provider,?\s*\}\)/,
        )
        expect(daytonaPlugin).toMatch(
          /envVars:\s*input\.env === undefined\s*\? undefined\s*:\s*\{ \.\.\.input\.env \}/,
        )
        expect(daytonaPlugin).not.toContain('process.env')
        for (const value of forbidden) {
          expect(daytonaPlugin).not.toContain(value)
        }
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
