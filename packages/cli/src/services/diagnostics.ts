import { Context, Effect, Layer } from 'effect'
import type { PlatformError } from 'effect/PlatformError'
import { patchPlanePlugins } from '@patchplane/plugins/registry'
import { CliConfigFile } from './config-file'
import { CliEnvFile } from './env-file'

export type DiagnosticStatus = 'ok' | 'warning' | 'error'

export interface Diagnostic {
  readonly code: string
  readonly severity: DiagnosticStatus
  readonly message: string
  readonly source: string
  readonly envVar?: string | undefined
  readonly requiredFor: readonly string[]
  readonly fix: string
  readonly docsUrl?: string | undefined
}

export interface DoctorInput {
  readonly surface?: string | undefined
  readonly plugins?: string | undefined
  readonly includeOptional?: boolean | undefined
}

function pluginSourcesForEnvVar(envVar: string) {
  return Object.values(patchPlanePlugins)
    .filter((plugin) => plugin.env.some((variable) => variable.name === envVar))
    .map((plugin) => plugin.id)
}

export interface DoctorResult {
  readonly failures: number
  readonly lines: readonly string[]
  readonly diagnostics: readonly Diagnostic[]
}

/** Aggregates CLI doctor diagnostics across config files and selected env vars. */
export class CliDiagnostics extends Context.Service<CliDiagnostics, {
  readonly collectDoctorLines: (input: DoctorInput) => Effect.Effect<DoctorResult, PlatformError>
}>()('patchplane/CliDiagnostics') {
  static readonly Live = Layer.effect(this)(
    Effect.gen(function* () {
      const configFile = yield* CliConfigFile
      const envFile = yield* CliEnvFile

      return {
        collectDoctorLines: (input) =>
          Effect.gen(function* () {
            let failures = 0
            const lines: string[] = []
            const diagnostics: Diagnostic[] = []
            const projectConfig = yield* configFile.readProjectConfigFile
            if (projectConfig === undefined) {
              failures++
              lines.push('missing patchplane.config.json')
              diagnostics.push({
                code: 'config.missing',
                severity: 'error',
                message: 'Missing patchplane.config.json',
                source: 'patchplane.config.json',
                requiredFor: ['app', 'githubWebhook'],
                fix: 'Run patchplane init --profile app --yes, or create patchplane.config.json at the repository root.',
              })
            } else {
              lines.push('ok      patchplane.config.json')
            }

            const results = yield* envFile.collectEnvCheck(input)
            for (const result of results) {
              if (!result.present && result.variable.required) {
                failures++
                diagnostics.push({
                  code: 'env.missing_required',
                  severity: 'error',
                  message: `Missing required environment variable ${result.variable.name}`,
                  source: pluginSourcesForEnvVar(result.variable.name).map((id) => `plugin:${id}`).join(', ') || 'env',
                  envVar: result.variable.name,
                  requiredFor: input.surface === undefined ? ['app', 'githubWebhook'] : [input.surface],
                  fix: `Add ${result.variable.name}=... to .env.local or the deployment secret store.`,
                })
              }
              lines.push(`${result.status.padEnd(7)} ${result.variable.name}`)
            }

            return { failures, lines, diagnostics }
          }),
      }
    }),
  )
}
