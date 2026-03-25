import { Daytona } from '@daytonaio/sdk'
import { Effect } from 'effect'
import type {
  BoundaryFailure,
  RuntimeAdapter,
  RuntimeExecutionOutput,
  RuntimeExecutionRequest,
  SandboxAdapter,
  SandboxExecutionRequest,
  SandboxExecutionResult,
} from '@patchplane/domain'

export interface DaytonaSandboxOptions {
  readonly apiKey?: string
  readonly apiUrl?: string
  readonly target?: string
  readonly timeoutMs: number
  readonly autoStopIntervalMinutes: number
  readonly ephemeral: boolean
}

function toBoundaryFailure(message: string, cause: unknown): BoundaryFailure {
  return {
    boundary: 'sandbox.daytona',
    message,
    retryable: true,
    cause,
  }
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

  return [
    `cd ${shellEscape(workingDirectory)}`,
    ...exports,
    command,
  ].join(' && ')
}

function createDaytonaClient(options: DaytonaSandboxOptions) {
  return new Daytona({
    ...(options.apiKey ? { apiKey: options.apiKey } : {}),
    ...(options.apiUrl ? { apiUrl: options.apiUrl } : {}),
    ...(options.target ? { target: options.target } : {}),
  })
}

export class DaytonaSandboxAdapter implements SandboxAdapter {
  readonly name = 'daytona-sandbox-adapter'

  constructor(private readonly options: DaytonaSandboxOptions) {}

  execute(
    request: SandboxExecutionRequest,
    runtime: RuntimeAdapter,
  ): Effect.Effect<SandboxExecutionResult, BoundaryFailure> {
    return Effect.tryPromise({
      try: async () => {
        const daytona = createDaytonaClient(this.options)
        const sandbox = await daytona.create({
          language: 'typescript',
          ephemeral: this.options.ephemeral,
          autoStopInterval: this.options.autoStopIntervalMinutes,
          labels: {
            workflowRunId: request.session.workflowRunId,
            runtimeSessionId: request.session.id,
          },
          envVars: request.env,
        })

        const executionSessionId = `patchplane-${request.session.id}`

        try {
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
            Math.ceil(this.options.timeoutMs / 1000),
          )

          const runtimeRequest: RuntimeExecutionRequest = {
            promptRequestId: request.promptRequestId,
            session: request.session,
            prompt: request.prompt,
            workingDirectory: request.workingDirectory,
            env: request.env,
          }

          const plan = await Effect.runPromise(
            runtime.createExecutionPlan(runtimeRequest),
          )

          await sandbox.process.createSession(executionSessionId)

          const result = await sandbox.process.executeSessionCommand(
            executionSessionId,
            {
              command: buildShellCommand(
                plan.workingDirectory,
                plan.env,
                plan.command,
              ),
            },
            Math.ceil(this.options.timeoutMs / 1000),
          )

          const output: RuntimeExecutionOutput = {
            exitCode: result.exitCode ?? 1,
            stdout: result.stdout ?? result.output ?? '',
            stderr: result.stderr ?? '',
          }

          const events = await Effect.runPromise(
            runtime.normalizeOutput(runtimeRequest, output),
          )

          return {
            externalSessionId: `${sandbox.id}:${executionSessionId}`,
            events: [...events],
          }
        } finally {
          await Promise.allSettled([
            sandbox.process.deleteSession(executionSessionId),
            this.options.ephemeral
              ? sandbox.delete(Math.ceil(this.options.timeoutMs / 1000))
              : sandbox.stop(Math.ceil(this.options.timeoutMs / 1000)),
          ])
        }
      },
      catch: (cause) =>
        toBoundaryFailure(
          'Failed to execute the workflow run inside Daytona.',
          cause,
        ),
    })
  }
}
