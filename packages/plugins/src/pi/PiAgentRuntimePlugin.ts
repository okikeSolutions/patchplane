import { Config, Effect, Layer } from 'effect'
import { getModels, getProviders } from '@earendil-works/pi-ai'
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  type AgentSession,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { RuntimeError } from '@patchplane/domain/errors'
import { RuntimeService, type RuntimeEvent } from '@patchplane/core/services/runtime-service'
import { PiAgentConfig } from './PiAgentConfig'

function readStringProperty(value: unknown, key: string) {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const property = Reflect.get(value, key)
  return typeof property === 'string' ? property : undefined
}

function findAssistantFailure(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }

  const role = readStringProperty(value, 'role')
  const stopReason = readStringProperty(value, 'stopReason')
  const errorMessage = readStringProperty(value, 'errorMessage')

  if (role === 'assistant' && (stopReason === 'error' || errorMessage !== undefined)) {
    return errorMessage ?? 'Pi coding agent stopped with an error'
  }

  return undefined
}

function collectEventFailure(event: unknown): string | undefined {
  if (typeof event !== 'object' || event === null) {
    return undefined
  }

  const messageFailure = findAssistantFailure(Reflect.get(event, 'message'))
  if (messageFailure !== undefined) {
    return messageFailure
  }

  const messages = Reflect.get(event, 'messages')
  if (Array.isArray(messages)) {
    for (const message of messages) {
      const failure = findAssistantFailure(message)
      if (failure !== undefined) {
        return failure
      }
    }
  }

  return undefined
}

export const PiAgentRuntimePlugin = {
  layer: Layer.effect(
    RuntimeService,
    Effect.gen(function* () {
      const config = yield* PiAgentConfig
      const activeSessions = new Map<string, AgentSession>()

      const createSession = async () => {
        const provider = getProviders().find((item) => item === config.provider)
        if (provider === undefined) {
          throw new Error(`Unsupported Pi provider: ${config.provider}`)
        }

        const model = getModels(provider).find((item) => item.id === config.model)
        if (model === undefined) {
          throw new Error(
            `Unsupported Pi model for ${config.provider}: ${config.model}`,
          )
        }

        const cwd = process.cwd()
        const agentDir = getAgentDir()
        const authStorage = AuthStorage.create()
        const modelRegistry = ModelRegistry.inMemory(authStorage)
        const settingsManager = SettingsManager.inMemory()
        const resourceLoader = new DefaultResourceLoader({
          cwd,
          agentDir,
          settingsManager,
          appendSystemPromptOverride: (base) => [...base, config.systemPrompt],
        })
        await resourceLoader.reload()

        const { session } = await createAgentSession({
          cwd,
          agentDir,
          model,
          authStorage,
          modelRegistry,
          resourceLoader,
          sessionManager: SessionManager.inMemory(cwd),
          settingsManager,
          sessionStartEvent: {
            type: 'session_start',
            reason: 'startup',
          },
        })

        return session
      }

      const getActiveSession = (operation: string, traceId: string) => {
        const session = activeSessions.get(traceId)
        if (session === undefined) {
          throw new RuntimeError({
            operation,
            message: `No active Pi runtime found for trace ${traceId}`,
            cause: { traceId },
          })
        }
        return session
      }

      return RuntimeService.of({
        abort: (input) =>
          Effect.tryPromise({
            try: async () => {
              const session = getActiveSession('pi.abort', input.traceId)
              await session.abort()
            },
            catch: (cause) =>
              cause instanceof RuntimeError
                ? cause
                : new RuntimeError({
                  operation: 'pi.abort',
                  message: 'Pi runtime control operation failed',
                  cause,
                }),
          }),
        followUp: (input) =>
          Effect.tryPromise({
            try: async () => {
              const session = getActiveSession('pi.followUp', input.traceId)
              await session.followUp(input.message)
            },
            catch: (cause) =>
              cause instanceof RuntimeError
                ? cause
                : new RuntimeError({
                  operation: 'pi.followUp',
                  message: 'Pi runtime control operation failed',
                  cause,
                }),
          }),
        runPrompt: (input) =>
          Effect.tryPromise({
            try: async () => {
              const events: RuntimeEvent[] = []
              let failure: string | undefined
              if (activeSessions.has(input.traceId)) {
                throw new RuntimeError({
                  operation: 'pi.runPrompt',
                  message: `Pi runtime already active for trace ${input.traceId}`,
                  cause: { traceId: input.traceId },
                })
              }

              const session = await createSession()
              const unsubscribe = session.subscribe((event) => {
                const type = readStringProperty(event, 'type') ?? 'unknown'
                events.push({
                  type,
                  occurredAt: Date.now(),
                  summary: type,
                })
                failure ??= collectEventFailure(event)
              })

              activeSessions.set(input.traceId, session)
              try {
                await session.prompt(input.prompt)
                for (const message of session.messages) {
                  failure ??= findAssistantFailure(message)
                  if (failure !== undefined) {
                    break
                  }
                }

                if (failure !== undefined) {
                  throw new RuntimeError({
                    operation: 'pi.runPrompt',
                    message: 'Pi coding agent run failed',
                    cause: { traceId: input.traceId, failure },
                  })
                }
              } finally {
                activeSessions.delete(input.traceId)
                unsubscribe()
                session.dispose()
              }

              return {
                provider: 'pi-coding-agent',
                events,
                summary: `Pi coding agent completed ${events.length} runtime events`,
              }
            },
            catch: (cause) =>
              cause instanceof RuntimeError
                ? cause
                : new RuntimeError({
                  operation: 'pi.runPrompt',
                  message: 'Pi coding agent failed to run prompt',
                  cause,
                }),
          }),
        steer: (input) =>
          Effect.tryPromise({
            try: async () => {
              const session = getActiveSession('pi.steer', input.traceId)
              await session.steer(input.message)
            },
            catch: (cause) =>
              cause instanceof RuntimeError
                ? cause
                : new RuntimeError({
                  operation: 'pi.steer',
                  message: 'Pi runtime control operation failed',
                  cause,
                }),
          }),
      })
    }),
  ),
  config: PiAgentConfig,
} satisfies {
  readonly layer: Layer.Layer<RuntimeService, Config.ConfigError>
  readonly config: typeof PiAgentConfig
}
