import { Context, Effect, Layer } from 'effect'
import type { PlatformError } from 'effect/PlatformError'
import { CliConfigFile } from './config-file'
import { CliEnvFile } from './env-file'

export type DiagnosticStatus = 'ok' | 'warning' | 'error'

export interface Diagnostic {
  readonly status: DiagnosticStatus
  readonly message: string
}

export interface DoctorInput {
  readonly surface?: string | undefined
  readonly plugins?: string | undefined
  readonly includeOptional?: boolean | undefined
}

export interface DoctorResult {
  readonly failures: number
  readonly lines: readonly string[]
}

/** Aggregates CLI doctor diagnostics across config files and selected env vars. */
export class CliDiagnostics extends Context.Service<CliDiagnostics, {
  readonly collectDoctorLines: (input: DoctorInput) => Effect.Effect<DoctorResult, PlatformError>
}>()('@patchplane/cli/CliDiagnostics') {
  static readonly Live = Layer.effect(this)(
    Effect.gen(function* () {
      const configFile = yield* CliConfigFile
      const envFile = yield* CliEnvFile

      return {
        collectDoctorLines: (input) =>
          Effect.gen(function* () {
            let failures = 0
            const lines: string[] = []
            const projectConfig = yield* configFile.readProjectConfigFile
            if (projectConfig === undefined) {
              failures++
              lines.push('missing patchplane.config.json')
            } else {
              lines.push(`ok      ${projectConfig.legacy ? '.patchplane/config.json (legacy)' : 'patchplane.config.json'}`)
              if (projectConfig.legacy) {
                failures++
                lines.push('missing migrate .patchplane/config.json to root patchplane.config.json')
              }
            }

            const results = yield* envFile.collectEnvCheck(input)
            for (const result of results) {
              if (!result.present && result.variable.required) failures++
              lines.push(`${result.status.padEnd(7)} ${result.variable.name}`)
            }

            return { failures, lines }
          }),
      }
    }),
  )
}
