import { Clock, Effect, Queue, Schedule, Schema, Stream } from 'effect'
import { SandboxError } from '@patchplane/domain/errors'
import { ProviderProcessId } from '@patchplane/domain/refinements'
import { sanitizeDaytonaCause } from './daytona-redaction'
import { formatEnvironmentAssignment, shellQuote } from './daytona-shell'

export interface DaytonaCommandSandbox {
  readonly process: {
    readonly executeCommand?: (
      command: string,
      cwd?: string,
      env?: Record<string, string>,
      timeout?: number,
    ) => Promise<{
      readonly exitCode?: number | undefined
      readonly result?: string | undefined
      readonly output?: string | undefined
      readonly stdout?: string | undefined
      readonly stderr?: string | undefined
    }>
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
      readonly result?: string | undefined
      readonly output?: string | undefined
      readonly stdout?: string | undefined
      readonly stderr?: string | undefined
    }>
    readonly getSessionCommand?: (
      sessionId: string,
      commandId: string,
    ) => Promise<{
      readonly id?: string | undefined
      readonly command?: string | undefined
      readonly exitCode?: number | undefined
    }>
    readonly getSessionCommandLogs?: {
      (
        sessionId: string,
        commandId: string,
      ): Promise<{
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
    readonly sendSessionCommandInput?: (
      sessionId: string,
      commandId: string,
      data: string,
    ) => Promise<void>
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

async function settleWithin<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Daytona operation deadline exceeded')),
          timeoutMs,
        )
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function processError(operation: string, message: string) {
  return (cause: unknown) =>
    new DaytonaProcessError({
      operation,
      message,
      cause: sanitizeDaytonaCause(cause),
    })
}

function withWorkingDirectoryAndEnv(
  command: string,
  env?: Record<string, string>,
) {
  const assignments =
    env === undefined
      ? ''
      : Object.entries(env)
          .map(([key, value]) => formatEnvironmentAssignment(key, value))
          .join(' ')

  return [
    `cd ${shellQuote(repositoryWorkingDirectory)}`,
    `${assignments.length === 0 ? '' : `${assignments} `}${command}`,
  ].join(' && ')
}

function boundCommandOutput(command: string, maxOutputBytes: number) {
  const script = [
    'const {spawn}=require("child_process");',
    'const command=process.argv[1];const limit=Number(process.argv[2]);',
    'const child=spawn("sh",["-c",command],{stdio:["ignore","pipe","pipe"]});',
    'let size=0,exceeded=false;const stdout=[],stderr=[];',
    'const capture=(target,chunk)=>{size+=chunk.length;if(size>limit){exceeded=true;child.kill("SIGKILL");return;}target.push(chunk);};',
    'child.stdout.on("data",chunk=>capture(stdout,chunk));child.stderr.on("data",chunk=>capture(stderr,chunk));',
    'child.on("error",error=>{process.stderr.write(String(error));process.exitCode=70;});',
    'child.on("close",code=>{if(exceeded){process.stderr.write("PatchPlane command output exceeded its trusted byte limit\\n");process.exitCode=65;return;}process.stdout.write(Buffer.concat(stdout));process.stderr.write(Buffer.concat(stderr));process.exitCode=Number.isInteger(code)?code:70;});',
  ].join('')
  return `node -e ${shellQuote(script)} ${shellQuote(command)} ${maxOutputBytes}`
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
      try: () =>
        settleWithin(
          sandbox.process.getSessionCommandLogs?.(
            sessionId,
            commandId,
            (chunk) => Queue.offerUnsafe(queue, { stream: 'stdout', chunk }),
            (chunk) => Queue.offerUnsafe(queue, { stream: 'stderr', chunk }),
          ) ??
            Promise.reject(
              new Error(
                'Daytona getSessionCommandLogs streaming is unavailable',
              ),
            ),
          30_000,
        ),
      catch: processError(
        'daytona.getSessionCommandLogs.stream',
        'Daytona failed to stream async command logs',
      ),
    }).pipe(Effect.ensuring(Effect.sync(() => Queue.endUnsafe(queue)))),
  )
}

export interface DaytonaAsyncSessionCommandHandle {
  readonly sessionId: ProviderProcessId
  readonly commandId: ProviderProcessId
  readonly command: string
  readonly sendInput: (data: string) => Effect.Effect<void, DaytonaProcessError>
  readonly getCommand: Effect.Effect<
    {
      readonly id: ProviderProcessId
      readonly command: string
      readonly exitCode?: number | undefined
    },
    DaytonaProcessError
  >
  readonly getLogs: (
    maxOutputBytes: number,
  ) => Effect.Effect<
    { readonly stdout: string; readonly stderr: string },
    DaytonaProcessError
  >
  readonly streamLogs: (
    onStdout: (chunk: string) => void,
    onStderr: (chunk: string) => void,
  ) => Effect.Effect<void, DaytonaProcessError>
  readonly deleteSession: Effect.Effect<void, DaytonaProcessError>
}

export const startSandboxSessionCommand = Effect.fn(
  '@patchplane/plugins/daytona/startSandboxSessionCommand',
)(function* (
  sandbox: DaytonaCommandSandbox,
  input: {
    readonly command: string
    readonly env?: Record<string, string> | undefined
    readonly timeoutSeconds: number
    readonly traceId: string
    readonly maxOutputBytes?: number | undefined
  },
) {
  const sessionId = yield* Schema.decodeUnknownEffect(ProviderProcessId)(
    `patchplane-${input.traceId}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80),
  ).pipe(
    Effect.mapError(
      (cause) =>
        new DaytonaProcessError({
          operation: 'daytona.createSession.identity',
          message: 'Daytona session identity is invalid',
          cause,
        }),
    ),
  )

  yield* Effect.tryPromise({
    try: () => settleWithin(sandbox.process.createSession(sessionId), 10_000),
    catch: processError(
      'daytona.createSession',
      'Daytona failed to create an async command session',
    ),
  })

  const cleanup = Effect.tryPromise({
    try: () => settleWithin(sandbox.process.deleteSession(sessionId), 5_000),
    catch: processError(
      'daytona.deleteSession',
      'Daytona failed to delete async command session within its deadline',
    ),
  }).pipe(Effect.ignore)

  return yield* Effect.gen(function* () {
    const command = yield* Effect.try({
      try: () =>
        withWorkingDirectoryAndEnv(
          input.maxOutputBytes === undefined
            ? input.command
            : boundCommandOutput(input.command, input.maxOutputBytes),
          input.env,
        ),
      catch: processError(
        'daytona.formatCommand',
        'Daytona command could not be formatted safely',
      ),
    })

    const response = yield* Effect.tryPromise({
      try: () =>
        settleWithin(
          sandbox.process.executeSessionCommand(
            sessionId,
            { command, runAsync: true, suppressInputEcho: true },
            input.timeoutSeconds,
          ),
          (input.timeoutSeconds + 5) * 1_000,
        ),
      catch: processError(
        'daytona.executeSessionCommand',
        'Daytona failed to start an async command session',
      ),
    })

    const commandId = yield* Schema.decodeUnknownEffect(ProviderProcessId)(
      response.cmdId,
    ).pipe(
      Effect.mapError(
        (cause) =>
          new DaytonaProcessError({
            operation: 'daytona.executeSessionCommand.identity',
            message: 'Daytona returned an invalid async command identity',
            cause,
          }),
      ),
    )
    return {
      sessionId,
      commandId,
      command,
      sendInput: (data: string) =>
        Effect.tryPromise({
          try: () =>
            settleWithin(
              sandbox.process.sendSessionCommandInput?.(
                sessionId,
                commandId,
                data,
              ) ??
                Promise.reject(
                  new Error('Daytona sendSessionCommandInput is unavailable'),
                ),
              5_000,
            ),
          catch: processError(
            'daytona.sendSessionCommandInput',
            'Daytona failed to send input to async command session',
          ),
        }),
      getCommand: Effect.tryPromise({
        try: () =>
          settleWithin(
            sandbox.process.getSessionCommand?.(sessionId, commandId) ??
              Promise.reject(
                new Error('Daytona getSessionCommand is unavailable'),
              ),
            5_000,
          ),
        catch: processError(
          'daytona.getSessionCommand',
          'Daytona failed to get async command status',
        ),
      }).pipe(
        Effect.flatMap((snapshot) =>
          Schema.decodeUnknownEffect(
            Schema.Struct({
              id: ProviderProcessId,
              command: Schema.String,
              exitCode: Schema.optional(Schema.Int),
            }),
          )(snapshot),
        ),
        Effect.mapError((cause) =>
          cause instanceof DaytonaProcessError
            ? cause
            : new DaytonaProcessError({
                operation: 'daytona.getSessionCommand.decode',
                message: 'Daytona returned an invalid async command status',
                cause,
              }),
        ),
      ),
      getLogs: (maxOutputBytes: number) =>
        Effect.gen(function* () {
          const snapshot = yield* Effect.tryPromise({
            try: () =>
              settleWithin(
                sandbox.process.getSessionCommandLogs?.(sessionId, commandId) ??
                  Promise.reject(
                    new Error(
                      'Daytona getSessionCommandLogs snapshot is unavailable',
                    ),
                  ),
                10_000,
              ),
            catch: processError(
              'daytona.getSessionCommandLogs.snapshot',
              'Daytona failed to retrieve bounded async command logs',
            ),
          })
          const decoded = yield* Schema.decodeUnknownEffect(
            Schema.Struct({
              output: Schema.optional(Schema.String),
              stdout: Schema.optional(Schema.String),
              stderr: Schema.optional(Schema.String),
            }),
          )(snapshot).pipe(
            Effect.mapError(
              (cause) =>
                new DaytonaProcessError({
                  operation: 'daytona.getSessionCommandLogs.decode',
                  message: 'Daytona returned an invalid command log snapshot',
                  cause,
                }),
            ),
          )
          const stdout = decoded.stdout ?? decoded.output ?? ''
          const stderr = decoded.stderr ?? ''
          if (stdout.length + stderr.length > maxOutputBytes) {
            return yield* new DaytonaProcessError({
              operation: 'daytona.getSessionCommandLogs.output',
              message: 'Daytona command output exceeded its trusted byte limit',
              cause: undefined,
            })
          }
          const size =
            new TextEncoder().encode(stdout).byteLength +
            new TextEncoder().encode(stderr).byteLength
          if (size > maxOutputBytes) {
            return yield* new DaytonaProcessError({
              operation: 'daytona.getSessionCommandLogs.output',
              message: 'Daytona command output exceeded its trusted byte limit',
              cause: undefined,
            })
          }
          return { stdout, stderr }
        }),
      streamLogs: (
        onStdout: (chunk: string) => void,
        onStderr: (chunk: string) => void,
      ) =>
        Effect.tryPromise({
          try: () =>
            settleWithin(
              sandbox.process.getSessionCommandLogs?.(
                sessionId,
                commandId,
                onStdout,
                onStderr,
              ) ??
                Promise.reject(
                  new Error(
                    'Daytona getSessionCommandLogs streaming is unavailable',
                  ),
                ),
              30_000,
            ),
          catch: processError(
            'daytona.getSessionCommandLogs.stream',
            'Daytona failed to stream async command logs',
          ),
        }),
      deleteSession: cleanup,
    }
  }).pipe(Effect.onError(() => cleanup))
})

export const waitForSandboxSessionCommand = Effect.fn(
  '@patchplane/plugins/daytona/waitForSandboxSessionCommand',
)(function* (
  handle: DaytonaAsyncSessionCommandHandle,
  input: { readonly timeoutSeconds: number; readonly maxOutputBytes: number },
) {
  const totalDuration = (input.timeoutSeconds + 15) * 1_000
  const deadline = (yield* Clock.currentTimeMillis) + totalDuration
  const pollAndCapture = Effect.gen(function* () {
    let exitCode: number | undefined
    while (exitCode === undefined) {
      const now = yield* Clock.currentTimeMillis
      if (now >= deadline) {
        return yield* new DaytonaProcessError({
          operation: 'daytona.getSessionCommand.timeout',
          message:
            'Daytona async command did not reach a terminal state before its deadline',
          cause: undefined,
        })
      }
      const callTimeout = Math.max(1, Math.min(5_000, deadline - now))
      const command = yield* Effect.raceFirst(
        handle.getCommand,
        Effect.sleep(callTimeout).pipe(
          Effect.andThen(
            Effect.fail(
              new DaytonaProcessError({
                operation: 'daytona.getSessionCommand.timeout',
                message: 'Daytona async command status read timed out',
                cause: undefined,
              }),
            ),
          ),
        ),
      ).pipe(Effect.retry(Schedule.recurs(2)))
      if (
        command.id !== handle.commandId ||
        command.command !== handle.command
      ) {
        return yield* new DaytonaProcessError({
          operation: 'daytona.getSessionCommand.identity',
          message:
            'Daytona command status did not match the persisted command identity',
          cause: undefined,
        })
      }
      exitCode = command.exitCode
      if (exitCode === undefined) yield* Effect.sleep('500 millis')
    }
    const now = yield* Clock.currentTimeMillis
    const logs = yield* Effect.raceFirst(
      handle.getLogs(input.maxOutputBytes),
      Effect.sleep(Math.max(1, Math.min(10_000, deadline - now))).pipe(
        Effect.andThen(
          Effect.fail(
            new DaytonaProcessError({
              operation: 'daytona.getSessionCommandLogs.timeout',
              message: 'Daytona bounded command log stream timed out',
              cause: undefined,
            }),
          ),
        ),
      ),
    )
    return { exitCode, stdout: logs.stdout, stderr: logs.stderr }
  })
  return yield* Effect.raceFirst(
    pollAndCapture,
    Effect.sleep(totalDuration).pipe(
      Effect.andThen(
        Effect.fail(
          new DaytonaProcessError({
            operation: 'daytona.getSessionCommand.deadline',
            message: 'Daytona command polling exceeded its hard deadline',
            cause: undefined,
          }),
        ),
      ),
    ),
  )
})

export const executeSandboxCommand = Effect.fn(
  '@patchplane/plugins/daytona/executeSandboxCommand',
)(function* (
  sandbox: DaytonaCommandSandbox,
  input: {
    readonly command: string
    readonly env?: Record<string, string> | undefined
    readonly timeoutSeconds: number
    readonly traceId: string
    readonly maxOutputBytes?: number | undefined
    readonly stateless?: boolean | undefined
  },
) {
  const command = yield* Effect.try({
    try: () =>
      withWorkingDirectoryAndEnv(
        input.maxOutputBytes === undefined
          ? input.command
          : boundCommandOutput(input.command, input.maxOutputBytes),
        input.env,
      ),
    catch: processError(
      'daytona.formatCommand',
      'Daytona command could not be formatted safely',
    ),
  })

  const response =
    input.stateless !== true || sandbox.process.executeCommand === undefined
      ? yield* Effect.gen(function* () {
          const sessionId = `patchplane-${input.traceId}`
            .replace(/[^A-Za-z0-9_-]/g, '-')
            .slice(0, 80)
          yield* Effect.tryPromise({
            try: () =>
              settleWithin(sandbox.process.createSession(sessionId), 10_000),
            catch: processError(
              'daytona.createSession',
              'Daytona failed to create a command session',
            ),
          })
          const cleanup = Effect.tryPromise({
            try: () =>
              settleWithin(sandbox.process.deleteSession(sessionId), 5_000),
            catch: processError(
              'daytona.deleteSession',
              'Daytona failed to delete a command session within its deadline',
            ),
          }).pipe(Effect.ignore)
          return yield* Effect.tryPromise({
            try: () =>
              settleWithin(
                sandbox.process.executeSessionCommand(
                  sessionId,
                  {
                    command,
                    runAsync: false,
                    suppressInputEcho: true,
                  },
                  input.timeoutSeconds,
                ),
                (input.timeoutSeconds + 5) * 1_000,
              ),
            catch: processError(
              'daytona.executeSessionCommand',
              'Daytona failed to execute a command session',
            ),
          }).pipe(Effect.ensuring(cleanup))
        })
      : yield* Effect.tryPromise({
          try: () =>
            settleWithin(
              sandbox.process.executeCommand!(
                command,
                undefined,
                undefined,
                input.timeoutSeconds,
              ),
              (input.timeoutSeconds + 5) * 1_000,
            ),
          catch: processError(
            'daytona.executeCommand',
            'Daytona failed to execute a stateless command',
          ),
        })

  const stdout = response.stdout ?? response.output ?? response.result ?? ''
  const stderr = response.stderr ?? ''
  const maxOutputBytes = input.maxOutputBytes ?? 10_000_001
  if (
    new TextEncoder().encode(stdout).byteLength +
      new TextEncoder().encode(stderr).byteLength >
    maxOutputBytes
  ) {
    return yield* new SandboxError({
      operation: 'daytona.executeCommand.output',
      message: 'Daytona command output exceeded its trusted byte limit',
      cause: undefined,
    })
  }
  return {
    exitCode: response.exitCode,
    stdout,
    ...(stderr.length === 0 ? {} : { stderr }),
  }
})
