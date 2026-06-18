import { Console, Effect } from 'effect'
import { Argument, CliError, Command } from 'effect/unstable/cli'
import {
  getPatchPlanePlugin,
  patchPlanePlugins,
  type PatchPlanePluginMetadata,
} from '@patchplane/plugins/registry'

export function pluginsListText() {
  const lines: string[] = []
  for (const plugin of Object.values(patchPlanePlugins) as readonly PatchPlanePluginMetadata[]) {
    lines.push(`${plugin.id} - ${plugin.name}`)
    lines.push(`  provides: ${plugin.provides.join(', ')}`)
    lines.push(`  surfaces: ${plugin.surfaces.join(', ')}`)
    if (plugin.dependsOn && plugin.dependsOn.length > 0) {
      lines.push(`  dependsOn: ${plugin.dependsOn.join(', ')}`)
    }
  }
  return lines.join('\n')
}

export function pluginsExplainText(id: string) {
  const plugin = getPatchPlanePlugin(id)
  if (plugin === undefined) {
    throw new Error(`Unknown plugin: ${id}`)
  }

  const lines = [
    `${plugin.id} - ${plugin.name}`,
    plugin.description,
    `layer: ${plugin.layerExport}`,
    `provides: ${plugin.provides.join(', ')}`,
    `surfaces: ${plugin.surfaces.join(', ')}`,
  ]
  if (plugin.dependsOn && plugin.dependsOn.length > 0) {
    lines.push(`dependsOn: ${plugin.dependsOn.join(', ')}`)
  }
  lines.push('env:')
  for (const variable of plugin.env) {
    lines.push(`  ${variable.required ? 'required' : 'optional'} ${variable.name}${variable.defaultValue ? `=${variable.defaultValue}` : ''}`)
  }
  return lines.join('\n')
}

const pluginIdArgument = Argument.string('id').pipe(
  Argument.withDescription('Plugin id to explain'),
  Argument.mapEffect((id) =>
    getPatchPlanePlugin(id) === undefined
      ? Effect.fail(new CliError.InvalidValue({
        option: 'id',
        value: id,
        expected: 'known plugin id',
        kind: 'argument',
      }))
      : Effect.succeed(id)
  ),
)

export const pluginsListCommand = Command.make('list', {}, () =>
  Console.log(pluginsListText())
).pipe(
  Command.withDescription('List available PatchPlane plugins.'),
  Command.withShortDescription('List plugins'),
)

export const pluginsExplainCommand = Command.make('explain', {
  id: pluginIdArgument,
}, ({ id }) =>
  Effect.sync(() => pluginsExplainText(id)).pipe(
    Effect.flatMap((text) => Console.log(text)),
  )
).pipe(
  Command.withDescription('Explain one PatchPlane plugin and its required environment variables.'),
  Command.withShortDescription('Explain plugin'),
)

export const pluginsCommand = Command.make('plugins', {}, () =>
  Effect.fail(new CliError.ShowHelp({
    commandPath: ['patchplane', 'plugins'],
    errors: [new CliError.MissingArgument({ argument: 'subcommand' })],
  })),
).pipe(
  Command.withDescription('Discover PatchPlane plugins.'),
  Command.withShortDescription('Inspect plugins'),
  Command.withSubcommands([pluginsListCommand, pluginsExplainCommand]),
)
