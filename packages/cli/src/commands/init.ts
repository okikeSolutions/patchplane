import { Console, Effect, Option } from 'effect'
import { CliError, Command, Flag } from 'effect/unstable/cli'
import {
  initApprovalMessage,
  CliConfigFile,
  initRecoveryMessage,
  type InitOptions,
  type ResolvedInitOptions,
} from '../services/config-file'
import { CliEnvFile } from '../services/env-file'
import { CliInteractivity } from '../services/interactivity'
import { failCommand } from '../services/errors'
import { promptForInitOptions } from '../prompts/init'

function failInit(message: string) {
  return failCommand(message)
}

function resolveInitOptions(input: InitOptions) {
  return Effect.gen(function* () {
    if (input.profile === 'app' && input.withPi) {
      return yield* new CliError.ShowHelp({
        commandPath: ['patchplane', 'init'],
        errors: [new CliError.InvalidValue({
          option: 'with-pi',
          value: 'true',
          expected: '--with-pi can only be used with --profile githubWebhook or --profile full',
          kind: 'flag',
        })],
      })
    }

    if (input.nonInteractive) {
      if (input.profile === undefined) return yield* failInit(initRecoveryMessage)
      if (!input.yes && !input.dryRun) return yield* failInit(initApprovalMessage)
      return { ...input, profile: input.profile } satisfies ResolvedInitOptions
    }

    if (input.profile !== undefined && (input.yes || input.dryRun)) {
      return { ...input, profile: input.profile } satisfies ResolvedInitOptions
    }

    const interactivity = yield* CliInteractivity
    if (!(yield* interactivity.isInteractive)) {
      if (input.profile !== undefined && !input.yes && !input.dryRun) {
        return yield* failInit(initApprovalMessage)
      }
      return yield* failInit(initRecoveryMessage)
    }

    const prompted = yield* promptForInitOptions({
      profile: input.profile,
      withPi: input.withPi ? true : undefined,
    })
    if (!prompted.confirmed) return undefined

    return {
      profile: prompted.profile,
      withPi: prompted.withPi,
      yes: input.yes,
      force: input.force,
      dryRun: input.dryRun,
      nonInteractive: input.nonInteractive,
    } satisfies ResolvedInitOptions
  })
}

export const initCommand = Command.make('init', {
  profile: Flag.choice('profile', ['app', 'githubWebhook', 'full'] as const).pipe(
    Flag.withDescription('Setup profile to initialize'),
    Flag.withMetavar('PROFILE'),
    Flag.optional,
  ),
  yes: Flag.boolean('yes').pipe(
    Flag.withAlias('y'),
    Flag.withDescription('Approve defaults and writes without confirmation'),
  ),
  force: Flag.boolean('force').pipe(
    Flag.withDescription('Overwrite generated config files where supported'),
  ),
  dryRun: Flag.boolean('dry-run').pipe(
    Flag.withDescription('Print planned changes without writing files'),
  ),
  withPi: Flag.boolean('with-pi').pipe(
    Flag.withDescription('Enable Daytona Pi execution for githubWebhook/full profiles'),
  ),
  nonInteractive: Flag.boolean('non-interactive').pipe(
    Flag.withDescription('Never prompt; require explicit flags'),
  ),
  json: Flag.boolean('json').pipe(
    Flag.withDescription('Emit machine-readable JSON to stdout'),
  ),
}, (input) =>
  Effect.gen(function* () {
    const resolved = yield* resolveInitOptions({
      profile: Option.getOrUndefined(input.profile),
      yes: input.yes,
      force: input.force,
      dryRun: input.dryRun,
      withPi: input.withPi,
      nonInteractive: input.nonInteractive,
    })
    if (resolved === undefined) return

    const configFile = yield* CliConfigFile
    const envFile = yield* CliEnvFile
    const messages = [
      yield* configFile.writeProjectConfig(resolved),
      yield* envFile.updateEnvForInit(resolved),
      yield* configFile.ensureStateDirectories(resolved),
    ]

    if (input.json) {
      yield* Console.log(JSON.stringify({
        ok: true,
        dryRun: resolved.dryRun,
        profile: resolved.profile,
        withPi: resolved.withPi,
        changes: messages.map((message) => ({ message })),
        next: 'patchplane doctor',
      }, null, 2))
      return
    }

    for (const message of messages) {
      yield* Console.log(message)
    }
    yield* Console.log('\nNext: patchplane doctor')
  })
).pipe(
  Command.withDescription('Initialize PatchPlane config, .env.local, and generated state directories.'),
  Command.withShortDescription('Initialize project'),
  Command.withExamples([
    { command: 'patchplane init', description: 'Run the interactive installer in a TTY' },
    { command: 'patchplane init --profile app --yes', description: 'Initialize app-only config without prompts' },
    { command: 'patchplane init --profile full --with-pi --yes', description: 'Initialize full local alpha with Daytona Pi execution' },
  ]),
)
