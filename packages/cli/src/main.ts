#!/usr/bin/env node
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeRuntime, NodeServices } from '@effect/platform-node'
import { Effect } from 'effect'
import { Command } from 'effect/unstable/cli'
import packageJson from '../package.json'
import { doctorCommand } from './commands/doctor'
import { envCommand } from './commands/env'
import { initCommand } from './commands/init'
import { pluginsCommand } from './commands/plugins'
import { patchPlaneRootCommand } from './command'
import { CliLayer } from './runtime'
import { CliConfigFlag, CliCwdFlag, CliDotenvFlag } from './services/global-options'

export const cliCommand = patchPlaneRootCommand.pipe(
  Command.withSubcommands([
    initCommand.pipe(Command.provide(CliLayer)),
    doctorCommand.pipe(Command.provide(CliLayer)),
    envCommand.pipe(Command.provide(CliLayer)),
    pluginsCommand.pipe(Command.provide(CliLayer)),
  ]),
  Command.withGlobalFlags([CliCwdFlag, CliConfigFlag, CliDotenvFlag]),
)

export const cliProgram = Command.run(cliCommand, {
  version: packageJson.version,
}).pipe(
  Effect.provide(NodeServices.layer),
)

export function main() {
  NodeRuntime.runMain(cliProgram)
}

const entrypoint = process.argv[1] === undefined ? undefined : resolve(process.argv[1])
if (entrypoint !== undefined && fileURLToPath(import.meta.url) === entrypoint) {
  main()
}
