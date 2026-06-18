import { Config, Effect, Layer } from 'effect'
import { Daytona } from '@daytona/sdk'
import { SandboxError } from '@patchplane/domain/errors'
import { SandboxService } from '@patchplane/core/services/sandbox-service'
import {
  DAYTONA_DEFAULT_COMMAND,
  DAYTONA_DEFAULT_COMMAND_TIMEOUT_SECONDS,
  DAYTONA_DEFAULT_DELETE_RETRY_ATTEMPTS,
  DAYTONA_DEFAULT_DELETE_TIMEOUT_SECONDS,
  DAYTONA_DEFAULT_PI_CLI_VERSION,
  DaytonaConfig,
} from './DaytonaConfig'
import {
  toDaytonaClientConfig,
  toDaytonaCreateSandboxParams,
} from './daytona-adapter'
import { executeSandboxCommand } from './daytona-process'
import { buildPiCommand, buildRedactedPiCommand } from './pi-command'
import { piProviderApiKeyEnv } from './pi-provider-env'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
        cause,
      }))
      if (attempt < totalAttempts) {
        await sleep(250 * attempt)
      }
    }
  }

  throw lastCause
}

export const DaytonaSandboxPlugin = {
  layer: Layer.effect(
    SandboxService,
    Effect.gen(function* () {
      const config = yield* DaytonaConfig

      const runWithSandbox = async <A>(input: {
        readonly traceId: string
        readonly repositoryFullName: string
      }, use: (sandbox: Awaited<ReturnType<Daytona['create']>>) => Promise<A>) => {
        const daytona = new Daytona(toDaytonaClientConfig(config))
        const sandbox = await daytona.create(
          toDaytonaCreateSandboxParams(config, input),
          { timeout: 90 },
        )

        try {
          await sandbox.waitUntilStarted(90)
          return await use(sandbox)
        } finally {
          await deleteSandboxWithRetries({
            daytona,
            sandbox,
            traceId: input.traceId,
            timeoutSeconds: DAYTONA_DEFAULT_DELETE_TIMEOUT_SECONDS,
            retryAttempts: DAYTONA_DEFAULT_DELETE_RETRY_ATTEMPTS,
          }).catch(() => undefined)
          await daytona[Symbol.asyncDispose]?.call(daytona).catch(() => undefined)
        }
      }

      return SandboxService.of({
        runRepositoryAgent: (input) =>
          Effect.tryPromise({
            try: async () => {
              const startedAt = Date.now()
              return runWithSandbox(input, async (sandbox) => {
                await sandbox.git.clone(
                  input.repositoryUrl,
                  'workspace/repo',
                  input.branch,
                  input.commitId,
                  input.gitUsername,
                  input.gitPassword,
                )
                const command = buildPiCommand({
                  provider: input.provider,
                  model: input.model,
                  prompt: input.prompt,
                  version: DAYTONA_DEFAULT_PI_CLI_VERSION,
                })
                const response = await executeSandboxCommand(sandbox, {
                  command,
                  env: piProviderApiKeyEnv(input.provider, input.apiKey),
                  timeoutSeconds: input.timeoutSeconds ?? DAYTONA_DEFAULT_COMMAND_TIMEOUT_SECONDS,
                  traceId: input.traceId,
                })

                return {
                  provider: 'daytona:pi',
                  sandboxId: sandbox.id,
                  command: buildRedactedPiCommand({
                    provider: input.provider,
                    model: input.model,
                    version: DAYTONA_DEFAULT_PI_CLI_VERSION,
                  }),
                  exitCode: response.exitCode,
                  stdout: response.stdout,
                  stderr: response.stderr,
                  startedAt,
                  completedAt: Date.now(),
                }
              })
            },
            catch: (cause) =>
              new SandboxError({
                operation: 'daytona.runRepositoryAgent',
                message: 'Daytona failed to run Pi agent in repository sandbox',
                cause,
              }),
          }),
        runRepositoryCommand: (input) =>
          Effect.tryPromise({
            try: async () => {
              const startedAt = Date.now()
              return runWithSandbox(input, async (sandbox) => {
                await sandbox.git.clone(
                  input.repositoryUrl,
                  'workspace/repo',
                  input.branch,
                  input.commitId,
                  input.gitUsername,
                  input.gitPassword,
                )
                const command = input.command.trim().length === 0
                  ? DAYTONA_DEFAULT_COMMAND
                  : input.command
                const response = await executeSandboxCommand(sandbox, {
                  command,
                  env: input.env === undefined ? undefined : { ...input.env },
                  timeoutSeconds: input.timeoutSeconds ?? DAYTONA_DEFAULT_COMMAND_TIMEOUT_SECONDS,
                  traceId: input.traceId,
                })

                return {
                  provider: 'daytona',
                  sandboxId: sandbox.id,
                  command,
                  exitCode: response.exitCode,
                  stdout: response.stdout,
                  stderr: response.stderr,
                  startedAt,
                  completedAt: Date.now(),
                }
              })
            },
            catch: (cause) =>
              new SandboxError({
                operation: 'daytona.runRepositoryCommand',
                message: 'Daytona failed to run repository command',
                cause,
              }),
          }),
      })
    }),
  ),
  config: DaytonaConfig,
} satisfies {
  readonly layer: Layer.Layer<SandboxService, Config.ConfigError>
  readonly config: typeof DaytonaConfig
}
