import { Console, Effect, Option } from 'effect'
import { CliError, Command, Flag } from 'effect/unstable/cli'
import { getPatchPlanePlugin } from '@patchplane/plugins/registry'
import { CliEnvFile, envTemplateText } from '../services/env-file'
import { failCommand, failSilently } from '../services/errors'
import { formatEnvCheckResults } from '../output/format'

const pluginsFlag = Flag.string('plugins').pipe(
  Flag.withDescription('Comma-separated plugin ids to inspect, e.g. github,convex'),
  Flag.withMetavar('IDS'),
  Flag.mapEffect((value) => {
    const unknown = value.split(',').map((item) => item.trim()).filter(Boolean).filter((id) => getPatchPlanePlugin(id) === undefined)
    return unknown.length === 0
      ? Effect.succeed(value)
      : Effect.fail(new CliError.InvalidValue({
        option: 'plugins',
        value,
        expected: `known plugin ids; unknown: ${unknown.join(', ')}`,
        kind: 'flag',
      }))
  }),
)

const envFlags = {
  surface: Flag.choice('surface', ['app', 'githubWebhook'] as const).pipe(
    Flag.withDescription('Runtime surface whose default plugins should be used'),
    Flag.withMetavar('SURFACE'),
    Flag.optional,
  ),
  plugins: pluginsFlag.pipe(Flag.optional),
  includeOptional: Flag.boolean('include-optional').pipe(
    Flag.withDescription('Include optional environment variables'),
  ),
  json: Flag.boolean('json').pipe(
    Flag.withDescription('Emit machine-readable JSON to stdout'),
  ),
} as const

function selection(input: {
  readonly surface: Option.Option<'app' | 'githubWebhook'>
  readonly plugins: Option.Option<string>
  readonly includeOptional: boolean
  readonly json: boolean
}) {
  return {
    surface: Option.getOrUndefined(input.surface),
    plugins: Option.getOrUndefined(input.plugins),
    includeOptional: input.includeOptional,
  }
}

export const envTemplateCommand = Command.make('template', envFlags, (input) =>
  Effect.sync(() => envTemplateText(selection(input))).pipe(
    Effect.flatMap((text) => Console.log(text)),
  )
).pipe(
  Command.withDescription('Print a .env.local template for selected PatchPlane plugins.'),
  Command.withShortDescription('Print env template'),
)

export const envCheckCommand = Command.make('check', envFlags, (input) =>
  Effect.gen(function* () {
    const envFile = yield* CliEnvFile
    const results = yield* envFile.collectEnvCheck(selection(input))
    const missingRequired = results.filter((result) => !result.present && result.variable.required).length
    if (input.json) {
      yield* Console.log(JSON.stringify({
        ok: missingRequired === 0,
        missingRequired,
        results,
      }, null, 2))
      if (missingRequired > 0) return yield* failSilently
      return undefined
    }

    for (const line of formatEnvCheckResults(results)) {
      yield* Console.log(line)
    }

    if (missingRequired > 0) {
      return yield* failCommand(`\nMissing required env vars: ${missingRequired}`)
    }
    return undefined
  })
).pipe(
  Command.withDescription('Check required environment variables for selected PatchPlane plugins.'),
  Command.withShortDescription('Check env vars'),
)

export const envCommand = Command.make('env', {}, () =>
  Effect.fail(new CliError.ShowHelp({
    commandPath: ['patchplane', 'env'],
    errors: [new CliError.MissingArgument({ argument: 'subcommand' })],
  })),
).pipe(
  Command.withDescription('Generate and validate PatchPlane environment variables.'),
  Command.withShortDescription('Manage env files'),
  Command.withSubcommands([envTemplateCommand, envCheckCommand]),
)
