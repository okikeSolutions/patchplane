import { Console, Effect, Runtime } from 'effect'

export class PatchPlaneCommandError extends Error {
  override readonly [Runtime.errorExitCode] = 1
  override readonly [Runtime.errorReported] = false
}

export class PatchPlaneSilentExit extends Error {
  override readonly [Runtime.errorExitCode] = 1
  override readonly [Runtime.errorReported] = false
}

export const failSilently = Effect.fail(new PatchPlaneSilentExit('PatchPlane command failed'))

export function failCommand(message: string) {
  return Console.error(message).pipe(
    Effect.andThen(Effect.fail(new PatchPlaneCommandError(message))),
  )
}
