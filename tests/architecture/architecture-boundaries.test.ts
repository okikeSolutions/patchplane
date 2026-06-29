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

  it.effect('keeps agent runtime packages out of trusted control-plane dependencies', () =>
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
          Effect.map(packageJson(path), (manifest) => ({ path, manifest }))
        ),
      )

      const violations = packageManifests.flatMap(({ path, manifest }) =>
        Object.keys({
          ...manifest.dependencies,
          ...manifest.devDependencies,
          ...manifest.optionalDependencies,
          ...manifest.peerDependencies,
        }).filter((dependency) => forbidden.has(dependency))
          .map((dependency) => ({ file: path, dependency }))
      )

      expect(violations).toEqual([])
    }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect('keeps Alchemy provisioning isolated to apps/infra', () =>
    Effect.gen(function* () {
      const imports = yield* importsForFiles([
        ...yield* sourceFilesUnder('apps'),
        ...yield* sourceFilesUnder('packages'),
      ])
      const violations = imports.filter(({ file, specifier }) => {
        const alchemyOrCloudflareProvisioningImport = specifier === 'alchemy' ||
          (specifier.startsWith('alchemy/') && specifier !== 'alchemy/Cloudflare/Bridge') ||
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
          file.startsWith('apps/source-control/') ||
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
      expect(githubWebhookRoute).toContain('dedicated source-control Worker')
      expect(githubWebhookRoute).not.toContain("import('@/effect/webhook-runtime')")
      expect(githubWebhookRoute).not.toContain('patchPlaneRuntime.runPromiseExit(program)')

      const startWorkflow = yield* fileText('apps/client/src/lib/start-workflow.ts')
      expect(startWorkflow).toContain('effectServerFn({')
      expect(startWorkflow).not.toContain('createServerFn')

      const runtimeControl = yield* fileText('apps/client/src/lib/control-runtime-session.ts')
      expect(runtimeControl).toContain('effectServerFn({')
      expect(runtimeControl).toContain('authorizeRuntimeControl')
      expect(runtimeControl).toContain('/internal/runtime/control')
      expect(runtimeControl).not.toContain('DaytonaSandboxPlugin')
      expect(runtimeControl).not.toContain('SandboxService')
      expect(runtimeControl).not.toContain('sandboxId')
      expect(runtimeControl).not.toContain('sessionId')
      expect(runtimeControl).not.toContain('commandId')

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

  it.effect('keeps hosted GitHub install and webhook routes wired across client and source-control Workers', () =>
    Effect.gen(function* () {
      const clientCallback = yield* fileText('apps/client/src/routes/api/github/install/callback.tsx')
      const clientWebhook = yield* fileText('apps/client/src/routes/api/github/webhook.tsx')
      const sourceControlWorker = yield* fileText('apps/source-control/src/worker.ts')
      const sourceControlGitHubRoutes = yield* fileText('apps/source-control/src/github/routes.ts')
      const infra = yield* fileText('apps/infra/alchemy.run.ts')

      expect(clientCallback).toContain('getSourceControlWorker')
      expect(clientCallback).toContain('Cloudflare.fromCloudflareFetcher')
      expect(clientCallback).toContain('https://source-control-worker/internal/github/install/sync')
      expect(clientCallback).toContain('authorization: `Bearer ${internalWorkerToken()}`')

      expect(sourceControlWorker).toContain("url.pathname === '/internal/github/install/sync'")
      expect(sourceControlWorker).toContain('syncGitHubInstallation(request)')
      expect(sourceControlWorker).toContain("url.pathname === '/api/github/webhook'")
      expect(sourceControlWorker).toContain('handleGitHubWebhook(request)')
      expect(sourceControlWorker).toContain("url.pathname === '/internal/runtime/control'")
      expect(sourceControlWorker).toContain('controlRuntimeSession(request)')

      expect(sourceControlGitHubRoutes).toContain('export async function syncGitHubInstallation')
      expect(sourceControlGitHubRoutes).toContain('export async function handleGitHubWebhook')
      expect(sourceControlGitHubRoutes).toContain('assertInternalAuthorization(request)')
      expect(sourceControlGitHubRoutes).toContain('ControlRuntimeSession')
      expect(sourceControlGitHubRoutes).toContain('IngestGitHubWebhook')
      expect(sourceControlGitHubRoutes).toContain('GitHubEventToWorkflowIntake')
      expect(sourceControlGitHubRoutes).toContain('RunSandboxAgentForWorkflow')
      expect(sourceControlGitHubRoutes).toContain('PublishSandboxResultToSource')

      expect(clientWebhook).toContain('GitHub webhooks are handled by the dedicated source-control Worker')
      expect(infra).toContain('SourceControlWorker')
      expect(infra).toContain('SOURCE_CONTROL_WORKER: sourceControlWorker')
    }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect('keeps Pi agent runtimes out of the web/control-plane composition', () =>
    Effect.gen(function* () {
      const appImports = yield* importsForFiles(yield* sourceFilesUnder('apps/client/src'))
      const violations = appImports.filter(({ specifier }) =>
        specifier === '@patchplane/plugins/pi/runtime-plugin' ||
        specifier === '@earendil-works/pi-coding-agent' ||
        specifier === '@earendil-works/pi-ai' ||
        specifier.startsWith('@earendil-works/pi-coding-agent/') ||
        specifier.startsWith('@earendil-works/pi-ai/')
      )

      expect(violations).toEqual([])
    }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect('keeps sandbox control-plane credentials out of core sandbox inputs and Daytona env injection', () =>
    Effect.gen(function* () {
      const sandboxService = yield* fileText('packages/core/src/services/sandbox-service.ts')
      const daytonaPlugin = yield* fileText('packages/plugins/src/daytona/DaytonaSandboxPlugin.ts')
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
        expect(sandboxService.toLowerCase()).not.toContain(value.toLowerCase())
      }

      expect(daytonaPlugin).toContain('piRuntimeEnvironment({ provider: input.provider })')
      expect(daytonaPlugin).toContain('envVars: input.env === undefined ? undefined : { ...input.env }')
      expect(daytonaPlugin).not.toContain('process.env')
      for (const value of forbidden) {
        expect(daytonaPlugin).not.toContain(value)
      }
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
        './services/storage-service',
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
      ]))
      expect(Object.keys(plugins.exports ?? {})).not.toContain('./pi/config')
      expect(plugins.scripts?.typecheck).toBeTruthy()
      expect(plugins.scripts?.test).toBeTruthy()
    }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )
})
