import { Console, Effect, Option } from 'effect'
import { CliError, Command, Flag } from 'effect/unstable/cli'
import { getPatchPlanePlugin } from '@patchplane/plugins/registry'
import { CliDiagnostics } from '../services/diagnostics'
import { failCommand } from '../services/errors'

const pluginsFlag = Flag.string('plugins').pipe(
  Flag.withDescription('Comma-separated plugin ids to check, e.g. github,convex'),
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

const doctorFlags = {
  surface: Flag.choice('surface', ['app', 'githubWebhook'] as const).pipe(
    Flag.withDescription('Runtime surface whose default plugins should be checked'),
    Flag.withMetavar('SURFACE'),
    Flag.optional,
  ),
  plugins: pluginsFlag.pipe(Flag.optional),
  includeOptional: Flag.boolean('include-optional').pipe(
    Flag.withDescription('Include optional environment variables in checks'),
  ),
} as const

export const doctorCommand = Command.make('doctor', doctorFlags, (input) =>
  Effect.gen(function* () {
    const diagnostics = yield* CliDiagnostics
    const result = yield* diagnostics.collectDoctorLines({
      surface: Option.getOrUndefined(input.surface),
      plugins: Option.getOrUndefined(input.plugins),
      includeOptional: input.includeOptional,
    })
    for (const line of result.lines) {
      yield* Console.log(line)
    }
    if (result.failures > 0) {
      return yield* failCommand(`\nDoctor found ${result.failures} issue(s).`)
    }
    return undefined
  })
).pipe(
  Command.withDescription('Run semantic checks for PatchPlane config, plugins, and environment.'),
  Command.withShortDescription('Run diagnostics'),
)
