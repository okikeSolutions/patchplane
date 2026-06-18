#!/usr/bin/env bun
import { Effect, Runtime } from 'effect'
import { CliError, Command } from 'effect/unstable/cli'
import { doctorCommand } from './commands/doctor'
import { envCommand } from './commands/env'
import { initCommand } from './commands/init'
import { pluginsCommand } from './commands/plugins'
import { cliRuntime } from './runtime'

export const patchPlaneCommand = Command.make('patchplane', {}, () =>
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
  Command.withSubcommands([
    initCommand,
    doctorCommand,
    envCommand,
    pluginsCommand,
  ]),
)

function reportMainError(error: unknown) {
  process.exitCode = Runtime.getErrorExitCode(error)
  if (!Runtime.getErrorReported(error)) return
  console.error(error instanceof Error ? error.message : String(error))
}

export async function main() {
  try {
    await cliRuntime.runPromise(
      Command.run(patchPlaneCommand, { version: '0.0.0' }),
    )
  } catch (error) {
    reportMainError(error)
  } finally {
    await cliRuntime.dispose()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
