import { Context, Effect, Layer } from 'effect'

export class CliInteractivity extends Context.Service<CliInteractivity, {
  readonly isInteractive: Effect.Effect<boolean>
}>()('@patchplane/cli/CliInteractivity') {}

export const CliInteractivityLive = Layer.succeed(CliInteractivity, {
  isInteractive: Effect.sync(() => {
    const stdinIsTTY: unknown = process.stdin.isTTY
    const stdoutIsTTY: unknown = process.stdout.isTTY
    return stdinIsTTY === true && stdoutIsTTY === true
  }),
})
