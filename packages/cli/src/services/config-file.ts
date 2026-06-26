import { Context, Effect, FileSystem, Layer, Path } from 'effect'
import type { PlatformError } from 'effect/PlatformError'

export type InitProfile = 'app' | 'githubWebhook' | 'full'

export interface InitOptions {
  readonly yes: boolean
  readonly force: boolean
  readonly dryRun: boolean
  readonly nonInteractive: boolean
  readonly profile?: InitProfile | undefined
  readonly withPi: boolean
}

export interface ResolvedInitOptions {
  readonly profile: InitProfile
  readonly withPi: boolean
  readonly yes: boolean
  readonly force: boolean
  readonly dryRun: boolean
  readonly nonInteractive: boolean
}

export interface ProjectConfigFile {
  readonly path: string
  readonly legacy: boolean
}

export const initRecoveryMessage = 'patchplane init needs an interactive terminal or explicit flags.\nRe-run with: patchplane init --profile app --yes'
export const initApprovalMessage = 'patchplane init in non-interactive mode requires --yes to write files.'

/** Builds the non-secret root `patchplane.config.json` content for an init profile. */
export function configForProfile(options: Pick<ResolvedInitOptions, 'profile' | 'withPi'>) {
  const githubPlugins = options.withPi
    ? ['github', 'convex', 'daytona', 'pi']
    : ['github', 'convex', 'daytona']

  const plugins = options.profile === 'app'
    ? { app: ['convex', 'workos'] }
    : options.profile === 'githubWebhook'
      ? { githubWebhook: githubPlugins }
      : { app: ['convex', 'workos'], githubWebhook: githubPlugins }

  return `${JSON.stringify({
    $schema: 'https://unpkg.com/patchplane/schema/patchplane.schema.json',
    plugins,
    runtime: {
      githubWebhookExecution: options.withPi ? 'daytona-pi' : 'daytona-command',
    },
  }, null, 2)}\n`
}

/** File-system boundary for CLI-managed project config and generated local state. */
export class CliConfigFile extends Context.Service<CliConfigFile, {
  readonly writeProjectConfig: (options: ResolvedInitOptions) => Effect.Effect<string, PlatformError>
  readonly ensureStateDirectories: (options: Pick<ResolvedInitOptions, 'dryRun'>) => Effect.Effect<string, PlatformError>
  readonly readProjectConfigFile: Effect.Effect<ProjectConfigFile | undefined, PlatformError>
}>()('patchplane/CliConfigFile') {
  static readonly Live = Layer.effect(this)(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      return {
        writeProjectConfig: (options) =>
          Effect.gen(function* () {
            const configPath = path.resolve('patchplane.config.json')
            if (!(yield* fs.exists(configPath)) || options.force) {
              if (!options.dryRun) yield* fs.writeFileString(configPath, configForProfile(options))
              return `${options.dryRun ? 'would write' : options.force ? 'wrote' : 'created'} patchplane.config.json`
            }
            return 'kept existing patchplane.config.json'
          }),
        ensureStateDirectories: (options) =>
          Effect.gen(function* () {
            if (!options.dryRun) {
              yield* fs.makeDirectory(path.resolve('.patchplane/logs'), { recursive: true })
              yield* fs.makeDirectory(path.resolve('.patchplane/cache'), { recursive: true })
              yield* fs.makeDirectory(path.resolve('.patchplane/state'), { recursive: true })
            }
            return `${options.dryRun ? 'would create' : 'created'} .patchplane/{logs,cache,state}`
          }),
        readProjectConfigFile: Effect.gen(function* () {
          const configPath = path.resolve('patchplane.config.json')
          if (yield* fs.exists(configPath)) {
            return { path: configPath, legacy: false } as const
          }
          const legacyPath = path.resolve('.patchplane/config.json')
          if (yield* fs.exists(legacyPath)) {
            return { path: legacyPath, legacy: true } as const
          }
          return undefined
        }),
      }
    }),
  )
}
