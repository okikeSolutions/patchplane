import { Config, Effect, Exit, Layer } from 'effect'
import { Daytona } from '@daytona/sdk'
import { SandboxError } from '@patchplane/domain/errors'
import { SandboxService } from '@patchplane/core/services/sandbox-service'
import {
  DAYTONA_DEFAULT_COMMAND,
  DAYTONA_DEFAULT_COMMAND_TIMEOUT_SECONDS,
  DAYTONA_DEFAULT_CREATE_TIMEOUT_SECONDS,
  DAYTONA_DEFAULT_DELETE_RETRY_ATTEMPTS,
  DAYTONA_DEFAULT_DELETE_TIMEOUT_SECONDS,
  DAYTONA_DEFAULT_PI_CLI_VERSION,
  DAYTONA_DEFAULT_START_TIMEOUT_SECONDS,
  DaytonaConfig,
} from './DaytonaConfig'
import {
  shouldRetainDaytonaSandboxes,
  toDaytonaClientConfig,
  toDaytonaCreateSandboxParams,
  toSandboxPolicy,
} from './daytona-adapter'
import { executeSandboxCommand } from './daytona-process'
import { sanitizeDaytonaCause } from './daytona-redaction'
import { buildPiCommand, buildRedactedPiCommand } from './pi-command'
import { piProviderApiKeyEnv } from './pi-provider-env'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function sandboxBoundaryError(operation: string, message: string) {
  return (cause: unknown) => new SandboxError({
    operation,
    message,
    cause: sanitizeDaytonaCause(cause),
  })
}

async function deleteSandboxWithRetries(input: {
  readonly daytona: Daytona
  readonly sandbox: Awaited<ReturnType<Daytona['create']>>
  readonly traceId: string
  readonly timeoutSeconds: number
  readonly retryAttempts: number
}) {
  const totalAttempts = Math.max(1, Math.floor(input.retryAttempts) + 1)
  let lastCause: unknown

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    try {
      await input.daytona.delete(input.sandbox, input.timeoutSeconds)
      return
    } catch (cause) {
      lastCause = cause
      await Effect.runPromise(Effect.logWarning('Failed to delete Daytona sandbox', {
        traceId: input.traceId,
        sandboxId: input.sandbox.id,
        attempt,
        totalAttempts,
        cause: sanitizeDaytonaCause(cause),
      }))
      if (attempt < totalAttempts) {
        await sleep(250 * attempt)
      }
    }
  }

  throw lastCause
}

type DaytonaSandbox = Awaited<ReturnType<Daytona['create']>>

export const DaytonaSandboxPlugin = {
  layer: Layer.effect(
    SandboxService,
    Effect.gen(function* () {
      const config = yield* DaytonaConfig

      const runWithSandbox = <A>(input: {
        readonly traceId: string
        readonly repositoryFullName: string
        readonly envVars?: Record<string, string> | undefined
      }, use: (sandbox: DaytonaSandbox) => Effect.Effect<A, unknown>) =>
        Effect.acquireUseRelease(
          Effect.gen(function* () {
            const daytona = new Daytona(toDaytonaClientConfig(config))
            const retainSandboxes = shouldRetainDaytonaSandboxes(config)
            const sandbox = yield* Effect.tryPromise({
              try: () => daytona.create(
                toDaytonaCreateSandboxParams(config, input),
                { timeout: DAYTONA_DEFAULT_CREATE_TIMEOUT_SECONDS },
              ),
              catch: sandboxBoundaryError('daytona.createSandbox', 'Daytona failed to create sandbox'),
            })

            yield* Effect.logInfo('Created Daytona sandbox', {
              traceId: input.traceId,
              sandboxId: sandbox.id,
              sandboxName: sandbox.name,
              target: sandbox.target,
              retainSandboxes,
            })

            yield* Effect.tryPromise({
              try: () => sandbox.waitUntilStarted(DAYTONA_DEFAULT_START_TIMEOUT_SECONDS),
              catch: sandboxBoundaryError('daytona.waitUntilStarted', 'Daytona sandbox failed to start'),
            })

            yield* Effect.logInfo('Started Daytona sandbox', {
              traceId: input.traceId,
              sandboxId: sandbox.id,
              state: sandbox.state,
            })

            return { daytona, sandbox, retainSandboxes }
          }),
          ({ sandbox }) => use(sandbox),
          ({ daytona, sandbox, retainSandboxes }) =>
            Effect.gen(function* () {
              if (retainSandboxes) {
                yield* Effect.logInfo('Retaining Daytona sandbox for inspection', {
                  traceId: input.traceId,
                  sandboxId: sandbox.id,
                })
              } else {
                const deleteExit = yield* Effect.tryPromise({
                  try: () => deleteSandboxWithRetries({
                    daytona,
                    sandbox,
                    traceId: input.traceId,
                    timeoutSeconds: DAYTONA_DEFAULT_DELETE_TIMEOUT_SECONDS,
                    retryAttempts: DAYTONA_DEFAULT_DELETE_RETRY_ATTEMPTS,
                  }),
                  catch: sandboxBoundaryError('daytona.deleteSandbox', 'Daytona failed to delete sandbox'),
                }).pipe(Effect.exit)

                if (Exit.isSuccess(deleteExit)) {
                  yield* Effect.logInfo('Deleted Daytona sandbox', {
                    traceId: input.traceId,
                    sandboxId: sandbox.id,
                  })
                } else {
                  yield* Effect.logWarning('Failed to delete Daytona sandbox after retries', {
                    traceId: input.traceId,
                    sandboxId: sandbox.id,
                  })
                }
              }

              yield* Effect.tryPromise({
                try: () => daytona[Symbol.asyncDispose]?.call(daytona) ?? Promise.resolve(),
                catch: sandboxBoundaryError('daytona.disposeClient', 'Daytona client disposal failed'),
              }).pipe(Effect.ignore)
            }),
        )

      const cloneRepository = (sandbox: DaytonaSandbox, input: {
        readonly repositoryUrl: string
        readonly branch?: string | undefined
        readonly commitId?: string | undefined
        readonly gitUsername?: string | undefined
        readonly gitPassword?: string | undefined
      }) =>
        Effect.tryPromise({
          try: () => sandbox.git.clone(
            input.repositoryUrl,
            'workspace/repo',
            input.branch,
            input.commitId,
            input.gitUsername,
            input.gitPassword,
          ),
          catch: sandboxBoundaryError('daytona.git.clone', 'Daytona failed to clone repository'),
        })

      return SandboxService.of({
        runRepositoryAgent: (input) =>
          Effect.gen(function* () {
            const startedAt = Date.now()
            return yield* runWithSandbox(
              { ...input, envVars: piProviderApiKeyEnv(input.provider, input.apiKey) },
              (sandbox) => Effect.gen(function* () {
                yield* cloneRepository(sandbox, input)
                const command = buildPiCommand({
                  provider: input.provider,
                  model: input.model,
                  prompt: input.prompt,
                  version: DAYTONA_DEFAULT_PI_CLI_VERSION,
                  thinking: input.thinking,
                })
                const timeoutSeconds = input.timeoutSeconds ?? DAYTONA_DEFAULT_COMMAND_TIMEOUT_SECONDS
                const response = yield* executeSandboxCommand(sandbox, {
                  command,
                  timeoutSeconds,
                  traceId: input.traceId,
                })

                return {
                  provider: 'daytona:pi',
                  sandboxId: sandbox.id,
                  command: buildRedactedPiCommand({
                    provider: input.provider,
                    model: input.model,
                    version: DAYTONA_DEFAULT_PI_CLI_VERSION,
                    thinking: input.thinking,
                  }),
                  exitCode: response.exitCode,
                  stdout: response.stdout,
                  stderr: response.stderr,
                  policy: toSandboxPolicy(config, { timeoutSeconds }),
                  startedAt,
                  completedAt: Date.now(),
                }
              }))
          }).pipe(
            Effect.mapError(
              (cause) =>
                new SandboxError({
                  operation: 'daytona.runRepositoryAgent',
                  message: 'Daytona failed to run Pi agent in repository sandbox',
                  cause,
                }),
            ),
          ),
        runRepositoryCommand: (input) =>
          Effect.gen(function* () {
            const startedAt = Date.now()
            return yield* runWithSandbox(
              { ...input, envVars: input.env === undefined ? undefined : { ...input.env } },
              (sandbox) => Effect.gen(function* () {
                yield* cloneRepository(sandbox, input)
                const command = input.command.trim().length === 0
                  ? DAYTONA_DEFAULT_COMMAND
                  : input.command
                const timeoutSeconds = input.timeoutSeconds ?? DAYTONA_DEFAULT_COMMAND_TIMEOUT_SECONDS
                const response = yield* executeSandboxCommand(sandbox, {
                  command,
                  timeoutSeconds,
                  traceId: input.traceId,
                })

                return {
                  provider: 'daytona',
                  sandboxId: sandbox.id,
                  command,
                  exitCode: response.exitCode,
                  stdout: response.stdout,
                  stderr: response.stderr,
                  policy: toSandboxPolicy(config, { timeoutSeconds }),
                  startedAt,
                  completedAt: Date.now(),
                }
              }))
          }).pipe(
            Effect.mapError(
              (cause) =>
                new SandboxError({
                  operation: 'daytona.runRepositoryCommand',
                  message: 'Daytona failed to run repository command',
                  cause,
                }),
            ),
          ),
      })
    }),
  ),
  config: DaytonaConfig,
} satisfies {
  readonly layer: Layer.Layer<SandboxService, Config.ConfigError>
  readonly config: typeof DaytonaConfig
}
