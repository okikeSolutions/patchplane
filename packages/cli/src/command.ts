import { Effect } from 'effect'
import { CliError, Command } from 'effect/unstable/cli'
import { doctorCommand } from './commands/doctor'
import { envCommand } from './commands/env'
import { initCommand } from './commands/init'
import { pluginsCommand } from './commands/plugins'

/** Root Effect CLI command for PatchPlane onboarding and diagnostics. */
export const patchPlaneRootCommand = Command.make('patchplane', {}, () =>
  Effect.fail(new CliError.ShowHelp({
    commandPath: ['patchplane'],
    errors: [new CliError.MissingArgument({ argument: 'subcommand' })],
  })),
).pipe(
  Command.withDescription('PatchPlane project setup and diagnostics.'),
  Command.withShortDescription('PatchPlane CLI'),
  Command.withExamples([
    { command: 'patchplane init --profile app --yes', description: 'Initialize app-only local config without prompts' },
    { command: 'patchplane doctor', description: 'Check config and required environment variables' },
  ]),
)

export const patchPlaneSubcommands = [
  initCommand,
  doctorCommand,
  envCommand,
  pluginsCommand,
] as const

export const patchPlaneCommand = patchPlaneRootCommand.pipe(
  Command.withSubcommands(patchPlaneSubcommands),
)
