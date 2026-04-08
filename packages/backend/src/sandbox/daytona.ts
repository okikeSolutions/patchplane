import { Daytona } from '@daytonaio/sdk'
import { Effect } from 'effect'
import {
  BoundaryFailure,
  type RuntimeAdapter,
  type RuntimeExecutionOutput,
  type RuntimeExecutionRequest,
  type SandboxAdapter,
  type SandboxExecutionRequest,
  type SandboxExecutionResult,
} from '@patchplane/domain'

export interface DaytonaSandboxOptions {
  readonly apiKey?: string
  readonly apiUrl?: string
  readonly target?: string
  readonly timeoutMs: number
  readonly autoStopIntervalMinutes: number
  readonly ephemeral: boolean
}

interface DaytonaSessionResult {
  readonly exitCode?: number
  readonly stdout?: string
  readonly output?: string
  readonly stderr?: string
}

interface DaytonaSandboxHandle {
  readonly id: string
  readonly git: {
    clone: (
      repoUrl: string,
      workingDirectory: string,
      baseBranch: string,
      destination?: string,
      username?: string,
      password?: string,
    ) => Promise<unknown>
  }
  readonly process: {
    executeCommand: (
      command: string,
      workingDirectory: string,
      env?: Record<string, string>,
      timeoutSeconds?: number,
    ) => Promise<unknown>
    createSession: (sessionId: string) => Promise<unknown>
    executeSessionCommand: (
      sessionId: string,
      request: { readonly command: string },
      timeoutSeconds?: number,
    ) => Promise<DaytonaSessionResult>
    deleteSession: (sessionId: string) => Promise<unknown>
  }
  delete: (timeoutSeconds?: number) => Promise<unknown>
  stop: (timeoutSeconds?: number) => Promise<unknown>
}

interface DaytonaClient {
  create: (options: {
    readonly language: string
    readonly ephemeral: boolean
    readonly autoStopInterval: number
    readonly labels: Record<string, string>
    readonly envVars: Record<string, string>
  }) => Promise<DaytonaSandboxHandle>
}

type DaytonaClientFactory = (options: DaytonaSandboxOptions) => DaytonaClient

function toBoundaryFailure(message: string, cause: unknown): BoundaryFailure {
  return new BoundaryFailure({
    boundary: 'sandbox.daytona',
    message,
    retryable: true,
    cause,
  })
}

function shellEscape(value: string) {
  return `'${value.replaceAll(`'`, `'"'"'`)}'`
}

function buildShellCommand(
  workingDirectory: string,
  env: Record<string, string>,
  command: string,
) {
  const exports = Object.entries(env).map(
    ([key, value]) => `export ${key}=${shellEscape(value)}`,
  )

  return [`cd ${shellEscape(workingDirectory)}`, ...exports, command].join(
    ' && ',
  )
}

function createDaytonaClient(options: DaytonaSandboxOptions): DaytonaClient {
  return new Daytona({
    ...(options.apiKey ? { apiKey: options.apiKey } : {}),
    ...(options.apiUrl ? { apiUrl: options.apiUrl } : {}),
    ...(options.target ? { target: options.target } : {}),
  })
}

function timeoutSeconds(timeoutMs: number) {
  return Math.ceil(timeoutMs / 1000)
}

function tryDaytonaPromise<A>(
  message: string,
  evaluate: () => Promise<A>,
): Effect.Effect<A, BoundaryFailure> {
  return Effect.tryPromise({
    try: () => evaluate(),
    catch: (cause) => toBoundaryFailure(message, cause),
  })
}

export class DaytonaSandboxAdapter implements SandboxAdapter {
  readonly name = 'daytona-sandbox-adapter'

  constructor(
    private readonly options: DaytonaSandboxOptions,
    private readonly clientFactory: DaytonaClientFactory = createDaytonaClient,
  ) {}

  execute(
    request: SandboxExecutionRequest,
    runtime: RuntimeAdapter,
  ): Effect.Effect<SandboxExecutionResult, BoundaryFailure> {
    const runtimeRequest: RuntimeExecutionRequest = {
      promptRequestId: request.promptRequestId,
      session: request.session,
      prompt: request.prompt,
      workingDirectory: request.workingDirectory,
      env: request.env,
    }
    const executionSessionId = `patchplane-${request.session.id}`
    const commandTimeoutSeconds = timeoutSeconds(this.options.timeoutMs)

    return Effect.scoped(
      Effect.gen(this, function* () {
        const plan = yield* runtime.createExecutionPlan(runtimeRequest)
        const sandbox = yield* Effect.acquireRelease(
          tryDaytonaPromise(
            'Failed to create the Daytona sandbox for the workflow run.',
            async () => {
              const daytona = this.clientFactory(this.options)

              return daytona.create({
                language: 'typescript',
                ephemeral: this.options.ephemeral,
                autoStopInterval: this.options.autoStopIntervalMinutes,
                labels: {
                  workflowRunId: request.session.workflowRunId,
                  runtimeSessionId: request.session.id,
                },
                envVars: request.env,
              })
            },
          ),
          (sandboxHandle) =>
            Effect.promise(() =>
              Promise.allSettled([
                Promise.resolve().then(() =>
                  sandboxHandle.process.deleteSession(executionSessionId),
                ),
                Promise.resolve().then(() =>
                  this.options.ephemeral
                    ? sandboxHandle.delete(commandTimeoutSeconds)
                    : sandboxHandle.stop(commandTimeoutSeconds),
                ),
              ]),
            ).pipe(Effect.map(() => undefined)),
        )

        yield* tryDaytonaPromise(
          'Failed to prepare the Daytona sandbox for execution.',
          async () => {
            await sandbox.git.clone(
              request.repoUrl,
              request.workingDirectory,
              request.baseBranch,
              undefined,
              request.gitCredentials?.username,
              request.gitCredentials?.password,
            )

            await sandbox.process.executeCommand(
              `git checkout -B ${shellEscape(request.targetBranch)}`,
              request.workingDirectory,
              undefined,
              commandTimeoutSeconds,
            )

            await sandbox.process.createSession(executionSessionId)
          },
        )

        const result = yield* tryDaytonaPromise(
          'Failed to execute the workflow run inside Daytona.',
          () =>
            sandbox.process.executeSessionCommand(
              executionSessionId,
              {
                command: buildShellCommand(
                  plan.workingDirectory,
                  plan.env,
                  plan.command,
                ),
              },
              commandTimeoutSeconds,
            ),
        )

        const output: RuntimeExecutionOutput = {
          exitCode: result.exitCode ?? 1,
          stdout: result.stdout ?? result.output ?? '',
          stderr: result.stderr ?? '',
        }
        const normalizedResult = yield* runtime.normalizeOutput(
          runtimeRequest,
          output,
        )

        return {
          externalSessionId: `${sandbox.id}:${executionSessionId}`,
          providerEvents: [...normalizedResult.providerEvents],
          events: [...normalizedResult.events],
        }
      }),
    )
  }
}
