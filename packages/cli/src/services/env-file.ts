import { Context, Effect, FileSystem, Layer, Path } from 'effect'
import type { PlatformError } from 'effect/PlatformError'
import {
  getPatchPlaneEnvVars,
  getPatchPlanePlugin,
  patchPlaneDefaultSurfaces,
  patchPlanePlugins,
  type PatchPlanePluginEnvVar,
  type PatchPlaneRuntimeSurface,
} from '@patchplane/plugins/registry'
import type { ResolvedInitOptions } from './config-file'

const surfaces: readonly PatchPlaneRuntimeSurface[] = ['app', 'githubWebhook']

export function isRuntimeSurface(value: string): value is PatchPlaneRuntimeSurface {
  return surfaces.some((surface) => surface === value)
}

export function parsePluginIds(input: {
  readonly plugins?: string | undefined
  readonly surface?: string | undefined
}) {
  if (input.plugins !== undefined) {
    return input.plugins.split(',').map((item) => item.trim()).filter(Boolean)
  }

  if (input.surface !== undefined) {
    if (!isRuntimeSurface(input.surface)) {
      throw new Error(`Unknown surface: ${input.surface}`)
    }
    return [...patchPlaneDefaultSurfaces[input.surface]]
  }

  return Object.keys(patchPlanePlugins)
}

export function validatePluginIds(pluginIds: readonly string[]) {
  const unknown = pluginIds.filter((id) => getPatchPlanePlugin(id) === undefined)
  if (unknown.length > 0) {
    throw new Error(`Unknown plugin(s): ${unknown.join(', ')}`)
  }
}

export function loadEnvFileContent(content: string, target: Map<string, string>) {
  for (const rawLine of content.split(/\r?\n/g)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) continue

    const equalsIndex = line.indexOf('=')
    if (equalsIndex <= 0) continue

    const key = line.slice(0, equalsIndex).trim()
    const rawValue = line.slice(equalsIndex + 1).trim()
    const value = rawValue.replace(/^(['"])(.*)\1$/, '$2')
    if (!target.has(key)) {
      target.set(key, value)
    }
  }
}

export interface EnvSelection {
  readonly plugins?: string | undefined
  readonly surface?: string | undefined
  readonly includeOptional?: boolean | undefined
}

export function selectedPluginIdsForInit(options: {
  readonly profile: 'app' | 'githubWebhook' | 'full'
  readonly withPi: boolean
}) {
  const githubPlugins = options.withPi
    ? ['github', 'convex', 'daytona', 'pi']
    : ['github', 'convex', 'daytona']

  if (options.profile === 'app') return ['convex', 'workos']
  if (options.profile === 'githubWebhook') return githubPlugins
  return ['convex', 'workos', ...githubPlugins]
}

export function missingEnvVarsForPlugins(
  pluginIds: readonly string[],
  envFileContent: string,
) {
  validatePluginIds(pluginIds)
  const existing = new Map<string, string>()
  loadEnvFileContent(envFileContent, existing)
  return getPatchPlaneEnvVars(pluginIds).filter((variable) =>
    variable.required && !existing.has(variable.name)
  )
}

export function formatEnvVarsForAppend(vars: readonly PatchPlanePluginEnvVar[]) {
  if (vars.length === 0) return ''
  const lines: string[] = []
  for (const variable of vars) {
    lines.push(`# ${variable.description}`)
    if (variable.secret) lines.push('# secret')
    lines.push(`${variable.name}=`)
    lines.push('')
  }
  return lines.join('\n')
}

export function selectedEnvVars(selection: EnvSelection) {
  const pluginIds = parsePluginIds(selection)
  validatePluginIds(pluginIds)
  return {
    pluginIds,
    vars: getPatchPlaneEnvVars(pluginIds)
      .filter((variable) => selection.includeOptional || variable.required),
  }
}

export function envTemplateText(selection: EnvSelection) {
  const selected = selectedEnvVars(selection)
  const lines = [
    '# PatchPlane env template',
    `# plugins: ${selected.pluginIds.join(', ')}`,
    '',
  ]

  for (const variable of selected.vars) {
    lines.push(`# ${variable.description}`)
    if (variable.secret) lines.push('# secret')
    const value = variable.defaultValue ?? ''
    const prefix = variable.required ? '' : '# '
    lines.push(`${prefix}${variable.name}=${value}`)
    lines.push('')
  }

  return lines.join('\n')
}

export interface EnvCheckResult {
  readonly variable: PatchPlanePluginEnvVar
  readonly present: boolean
  readonly status: 'ok' | 'missing' | 'unset'
}

export type EnvCheckResults = ReadonlyArray<EnvCheckResult>

export class CliEnvFile extends Context.Service<CliEnvFile, {
  readonly loadKnownEnvFiles: Effect.Effect<Map<string, string>, PlatformError>
  readonly collectEnvCheck: (selection: EnvSelection) => Effect.Effect<EnvCheckResults, PlatformError>
  readonly updateEnvForInit: (options: ResolvedInitOptions) => Effect.Effect<string, PlatformError>
}>()('@patchplane/cli/CliEnvFile') {
  static readonly Live = Layer.effect(this)(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      const loadEnvFile = (filePath: string, target: Map<string, string>) =>
        Effect.gen(function* () {
          if (!(yield* fs.exists(filePath))) return
          const content = yield* fs.readFileString(filePath)
          loadEnvFileContent(content, target)
        })

      const loadKnownEnvFiles = Effect.gen(function* () {
        const values = new Map<string, string>()
        for (const [key, value] of Object.entries(process.env)) {
          if (value !== undefined) values.set(key, value)
        }

        for (const envPath of [
          '.env',
          '.env.local',
          'apps/client/.env.local',
          'packages/backend/.env.local',
        ]) {
          yield* loadEnvFile(path.resolve(envPath), values)
        }

        return values
      })

      return {
        loadKnownEnvFiles,
        collectEnvCheck: (selection) =>
          Effect.gen(function* () {
            const selected = selectedEnvVars(selection)
            const values = yield* loadKnownEnvFiles

            return selected.vars.map((variable): EnvCheckResult => {
              const value = values.get(variable.name)
              const present = value !== undefined && value.trim().length > 0
              return {
                variable,
                present,
                status: present ? 'ok' : variable.required ? 'missing' : 'unset',
              }
            })
          }),
        updateEnvForInit: (options) =>
          Effect.gen(function* () {
            const envPath = path.resolve('.env.local')
            const envContent = (yield* fs.exists(envPath)) ? yield* fs.readFileString(envPath) : ''
            const missingEnvVars = missingEnvVarsForPlugins(
              selectedPluginIdsForInit(options),
              envContent,
            )
            if (missingEnvVars.length === 0) return 'kept existing .env.local'
            if (!options.dryRun) {
              const appendText = formatEnvVarsForAppend(missingEnvVars)
              const prefix = envContent.length === 0 || envContent.endsWith('\n') ? '' : '\n'
              yield* fs.writeFileString(envPath, `${envContent}${prefix}${appendText}`)
            }
            return `${options.dryRun ? 'would update' : envContent.length === 0 ? 'created' : 'updated'} .env.local`
          }),
      }
    }),
  )
}
