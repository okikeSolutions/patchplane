import { Console, Effect } from 'effect'
import { Argument, CliError, Command, Flag } from 'effect/unstable/cli'
import {
  getPatchPlanePlugin,
  patchPlanePlugins,
  type PatchPlanePluginId,
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

function isPluginId(id: string): id is PatchPlanePluginId {
  return getPatchPlanePlugin(id) !== undefined
}

export function pluginsExplainText(id: PatchPlanePluginId) {
  const plugin: PatchPlanePluginMetadata = patchPlanePlugins[id]
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
    !isPluginId(id)
      ? Effect.fail(new CliError.InvalidValue({
        option: 'id',
        value: id,
        expected: 'known plugin id',
        kind: 'argument',
      }))
      : Effect.succeed(id)
  ),
)

export const pluginsListCommand = Command.make('list', {
  json: Flag.boolean('json').pipe(
    Flag.withDescription('Emit machine-readable JSON to stdout'),
  ),
}, ({ json }) =>
  Console.log(json
    ? JSON.stringify({ plugins: Object.values(patchPlanePlugins) }, null, 2)
    : pluginsListText())
).pipe(
  Command.withDescription('List available PatchPlane plugins.'),
  Command.withShortDescription('List plugins'),
)

export const pluginsExplainCommand = Command.make('explain', {
  id: pluginIdArgument,
  json: Flag.boolean('json').pipe(
    Flag.withDescription('Emit machine-readable JSON to stdout'),
  ),
}, ({ id, json }) => {
  const plugin = getPatchPlanePlugin(id)
  return plugin === undefined
    ? Effect.fail(new CliError.InvalidValue({
      option: 'id',
      value: id,
      expected: 'known plugin id',
      kind: 'argument',
    }))
    : Console.log(json ? JSON.stringify({ plugin }, null, 2) : pluginsExplainText(id))
}).pipe(
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
