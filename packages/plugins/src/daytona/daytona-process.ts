import { Effect, Queue, Schema, Stream } from 'effect'
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
      readonly cmdId?: string | undefined
      readonly exitCode?: number | undefined
      readonly output?: string | undefined
      readonly stdout?: string | undefined
      readonly stderr?: string | undefined
    }>
    readonly getSessionCommand?: (sessionId: string, commandId: string) => Promise<{
      readonly id?: string | undefined
      readonly command?: string | undefined
      readonly exitCode?: number | undefined
    }>
    readonly getSessionCommandLogs?: {
      (sessionId: string, commandId: string): Promise<{
        readonly output?: string | undefined
        readonly stdout?: string | undefined
        readonly stderr?: string | undefined
      }>
      (
        sessionId: string,
        commandId: string,
        onStdout: (chunk: string) => void,
        onStderr: (chunk: string) => void,
      ): Promise<void>
    }
    readonly sendSessionCommandInput?: (sessionId: string, commandId: string, data: string) => Promise<void>
    readonly deleteSession: (sessionId: string) => Promise<void>
  }
}

export class DaytonaProcessError extends Schema.TaggedErrorClass<DaytonaProcessError>()(
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

export interface DaytonaLogChunk {
  readonly stream: 'stdout' | 'stderr'
  readonly chunk: string
}

export function streamSandboxSessionCommandLogs(
  sandbox: DaytonaCommandSandbox,
  sessionId: string,
  commandId: string,
): Stream.Stream<DaytonaLogChunk, DaytonaProcessError> {
  return Stream.callback<DaytonaLogChunk, DaytonaProcessError>((queue) =>
    Effect.tryPromise({
      try: () => sandbox.process.getSessionCommandLogs?.(
        sessionId,
        commandId,
        (chunk) => Queue.offerUnsafe(queue, { stream: 'stdout', chunk }),
        (chunk) => Queue.offerUnsafe(queue, { stream: 'stderr', chunk }),
      ) ?? Promise.reject(new Error('Daytona getSessionCommandLogs streaming is unavailable')),
      catch: processError('daytona.getSessionCommandLogs.stream', 'Daytona failed to stream async command logs'),
    }).pipe(
      Effect.ensuring(Effect.sync(() => Queue.endUnsafe(queue))),
    )
  )
}

export interface DaytonaAsyncSessionCommandHandle {
  readonly sessionId: string
  readonly commandId: string
  readonly sendInput: (data: string) => Effect.Effect<void, DaytonaProcessError>
  readonly getCommand: () => Effect.Effect<{ readonly exitCode?: number | undefined }, DaytonaProcessError>
  readonly getLogs: () => Effect.Effect<{ readonly stdout: string; readonly stderr?: string | undefined }, DaytonaProcessError>
  readonly streamLogs: (
    onStdout: (chunk: string) => void,
    onStderr: (chunk: string) => void,
  ) => Effect.Effect<void, DaytonaProcessError>
  readonly deleteSession: () => Effect.Effect<void, DaytonaProcessError>
}

export const startSandboxSessionCommand = Effect.fn(
  '@patchplane/plugins/daytona/startSandboxSessionCommand',
)(function*(sandbox: DaytonaCommandSandbox, input: {
  readonly command: string
  readonly env?: Record<string, string> | undefined
  readonly timeoutSeconds: number
  readonly traceId: string
}) {
  const sessionId = `patchplane-${input.traceId}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80)

  yield* Effect.tryPromise({
    try: () => sandbox.process.createSession(sessionId),
    catch: processError('daytona.createSession', 'Daytona failed to create an async command session'),
  })

  const command = yield* Effect.try({
    try: () => withWorkingDirectoryAndEnv(input.command, input.env),
    catch: processError('daytona.formatCommand', 'Daytona command could not be formatted safely'),
  })

  const response = yield* Effect.tryPromise({
    try: () => sandbox.process.executeSessionCommand(
      sessionId,
      { command, runAsync: true, suppressInputEcho: true },
      input.timeoutSeconds,
    ),
    catch: processError('daytona.executeSessionCommand', 'Daytona failed to start an async command session'),
  })

  if (response.cmdId === undefined || response.cmdId.length === 0) {
    return yield* new DaytonaProcessError({
      operation: 'daytona.executeSessionCommand',
      message: 'Daytona did not return a command id for async command session',
      cause: undefined,
    })
  }

  const commandId = response.cmdId
  return {
    sessionId,
    commandId,
    sendInput: (data: string) => Effect.tryPromise({
      try: () => sandbox.process.sendSessionCommandInput?.(sessionId, commandId, data) ?? Promise.reject(new Error('Daytona sendSessionCommandInput is unavailable')),
      catch: processError('daytona.sendSessionCommandInput', 'Daytona failed to send input to async command session'),
    }),
    getCommand: () => Effect.tryPromise({
      try: async () => await sandbox.process.getSessionCommand?.(sessionId, commandId) ?? {},
      catch: processError('daytona.getSessionCommand', 'Daytona failed to get async command status'),
    }),
    getLogs: () => Effect.tryPromise({
      try: async () => {
        const logs = await sandbox.process.getSessionCommandLogs?.(sessionId, commandId)
        return { stdout: logs?.stdout ?? logs?.output ?? '', stderr: logs?.stderr ?? undefined }
      },
      catch: processError('daytona.getSessionCommandLogs', 'Daytona failed to get async command logs'),
    }),
    streamLogs: (onStdout: (chunk: string) => void, onStderr: (chunk: string) => void) => Effect.tryPromise({
      try: () => sandbox.process.getSessionCommandLogs?.(sessionId, commandId, onStdout, onStderr) ?? Promise.reject(new Error('Daytona getSessionCommandLogs streaming is unavailable')),
      catch: processError('daytona.getSessionCommandLogs.stream', 'Daytona failed to stream async command logs'),
    }),
    deleteSession: () => Effect.tryPromise({
      try: () => sandbox.process.deleteSession(sessionId),
      catch: processError('daytona.deleteSession', 'Daytona failed to delete async command session'),
    }),
  }
})

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
