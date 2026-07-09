import { Context, Effect, FileSystem, Layer, Path } from 'effect'
import type { PlatformError } from 'effect/PlatformError'
import { patchPlaneDefaultSurfaces, type PatchPlanePluginId } from '@patchplane/plugins/registry'
import { CliGlobalOptions } from './global-options'

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

interface ProjectConfigFile {
  readonly path: string
}

export const initRecoveryMessage = 'patchplane init needs an interactive terminal or explicit flags.\nRe-run with: patchplane init --profile app --yes'
export const initApprovalMessage = 'patchplane init in non-interactive mode requires --yes to write files.'

function dedupePluginIds(pluginIds: readonly PatchPlanePluginId[]) {
  return [...new Set(pluginIds)]
}

export function pluginIdsForInitProfile(profile: InitProfile) {
  if (profile === 'app') return [...patchPlaneDefaultSurfaces.app]
  if (profile === 'githubWebhook') return [...patchPlaneDefaultSurfaces.githubWebhook]
  return dedupePluginIds([
    ...patchPlaneDefaultSurfaces.app,
    ...patchPlaneDefaultSurfaces.githubWebhook,
  ])
}

export function pluginIdsForInitSurface(profile: InitProfile) {
  if (profile === 'app') {
    return { app: pluginIdsForInitProfile('app') }
  }
  if (profile === 'githubWebhook') {
    return { githubWebhook: pluginIdsForInitProfile('githubWebhook') }
  }
  return {
    app: pluginIdsForInitProfile('app'),
    githubWebhook: pluginIdsForInitProfile('githubWebhook'),
  }
}

/** Builds the non-secret root `patchplane.config.json` content for an init profile. */
export function configForProfile(options: Pick<ResolvedInitOptions, 'profile' | 'withPi'>) {
  return `${JSON.stringify({
    $schema: 'https://unpkg.com/patchplane/schema/patchplane.schema.json',
    plugins: pluginIdsForInitSurface(options.profile),
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
      const globalOptions = yield* CliGlobalOptions

      const resolveProjectPath = (filePath: string) =>
        globalOptions.cwd === undefined ? path.resolve(filePath) : path.resolve(globalOptions.cwd, filePath)

      return {
        writeProjectConfig: (options) =>
          Effect.gen(function* () {
            const configPath = globalOptions.configFile ?? resolveProjectPath('patchplane.config.json')
            if (!(yield* fs.exists(configPath)) || options.force) {
              if (!options.dryRun) {
                yield* fs.makeDirectory(path.dirname(configPath), { recursive: true })
                yield* fs.writeFileString(configPath, configForProfile(options))
              }
              return `${options.dryRun ? 'would write' : options.force ? 'wrote' : 'created'} patchplane.config.json`
            }
            return 'kept existing patchplane.config.json'
          }),
        ensureStateDirectories: (options) =>
          Effect.gen(function* () {
            if (!options.dryRun) {
              yield* fs.makeDirectory(resolveProjectPath('.patchplane/logs'), { recursive: true })
              yield* fs.makeDirectory(resolveProjectPath('.patchplane/cache'), { recursive: true })
              yield* fs.makeDirectory(resolveProjectPath('.patchplane/state'), { recursive: true })
            }
            return `${options.dryRun ? 'would create' : 'created'} .patchplane/{logs,cache,state}`
          }),
        readProjectConfigFile: Effect.gen(function* () {
          const configPath = globalOptions.configFile ?? resolveProjectPath('patchplane.config.json')
          if (yield* fs.exists(configPath)) {
            return { path: configPath } as const
          }
          return undefined
        }),
      }
    }),
  )
}
