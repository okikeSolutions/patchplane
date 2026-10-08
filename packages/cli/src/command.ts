import { Effect } from 'effect'
import { CliError, Command } from 'effect/cli'
/** Root Effect CLI command for PatchPlane onboarding and diagnostics. */
export const patchPlaneRootCommand = Command.make('patchplane', {}, () =>
  Effect.fail(
    new CliError.ShowHelp({
      commandPath: ['patchplane'],
      errors: [new CliError.MissingArgument({ argument: 'subcommand' })],
    }),
  ),
).pipe(
  Command.withDescription('PatchPlane project setup and diagnostics.'),
  Command.withShortDescription('PatchPlane CLI'),
  Command.withExamples([
    {
      command: 'patchplane init --profile app --yes',
      description: 'Initialize app-only local config without prompts',
    },
    {
      command: 'patchplane doctor',
      description: 'Check config and required environment variables',
    },
  ]),
)
