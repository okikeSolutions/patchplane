import { Effect, Schema } from 'effect'
import { sanitizeDaytonaCause } from './daytona-redaction'
import { formatEnvironmentAssignment, shellQuote } from './daytona-shell'

export interface DaytonaCommandSandbox {
  readonly process: {
    readonly createSession: (sessionId: string) => Promise<void>
    readonly executeSessionCommand: (
      sessionId: string,
      request: {
        readonly command: string
        readonly runAsync?: boolean
        readonly suppressInputEcho?: boolean
      },
      timeout?: number,
    ) => Promise<{
      readonly exitCode?: number | undefined
      readonly output?: string | undefined
      readonly stdout?: string | undefined
      readonly stderr?: string | undefined
    }>
    readonly deleteSession: (sessionId: string) => Promise<void>
  }
}

class DaytonaProcessError extends Schema.TaggedErrorClass<DaytonaProcessError>()(
  'DaytonaProcessError',
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

const repositoryWorkingDirectory = 'workspace/repo'

function processError(operation: string, message: string) {
  return (cause: unknown) => new DaytonaProcessError({
    operation,
    message,
    cause: sanitizeDaytonaCause(cause),
  })
}

function withWorkingDirectoryAndEnv(command: string, env?: Record<string, string>) {
  const assignments = env === undefined
    ? ''
    : Object.entries(env)
      .map(([key, value]) => formatEnvironmentAssignment(key, value))
      .join(' ')

  return [
    `cd ${shellQuote(repositoryWorkingDirectory)}`,
    `${assignments.length === 0 ? '' : `${assignments} `}${command}`,
  ].join(' && ')
}

export const executeSandboxCommand = Effect.fn(
  '@patchplane/plugins/daytona/executeSandboxCommand',
)(function*(sandbox: DaytonaCommandSandbox, input: {
  readonly command: string
  readonly env?: Record<string, string> | undefined
  readonly timeoutSeconds: number
  readonly traceId: string
}) {
  const sessionId = `patchplane-${input.traceId}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80)

  yield* Effect.tryPromise({
    try: () => sandbox.process.createSession(sessionId),
    catch: processError('daytona.createSession', 'Daytona failed to create a command session'),
  })

  const cleanup = Effect.tryPromise({
    try: () => sandbox.process.deleteSession(sessionId),
    catch: processError('daytona.deleteSession', 'Daytona failed to delete a command session'),
  }).pipe(Effect.ignore)

  return yield* Effect.gen(function* () {
    const command = yield* Effect.try({
      try: () => withWorkingDirectoryAndEnv(input.command, input.env),
      catch: processError('daytona.formatCommand', 'Daytona command could not be formatted safely'),
    })
    const response = yield* Effect.tryPromise({
      try: () => sandbox.process.executeSessionCommand(
        sessionId,
        {
          command,
          runAsync: false,
          suppressInputEcho: true,
        },
        input.timeoutSeconds,
      ),
      catch: processError('daytona.executeSessionCommand', 'Daytona failed to execute a command session'),
    })

    return {
      exitCode: response.exitCode,
      stdout: response.stdout ?? response.output ?? '',
      stderr: response.stderr ?? undefined,
    }
  }).pipe(Effect.ensuring(cleanup))
})
