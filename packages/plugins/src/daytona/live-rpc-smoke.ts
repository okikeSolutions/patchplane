import { ConfigProvider, Effect, Schema } from 'effect'
import { Daytona } from '@daytona/sdk'
import { SandboxService, type SandboxRuntimeEvent } from '@patchplane/core/services/sandbox-service'
import { DaytonaConfig } from './DaytonaConfig'
import { toDaytonaClientConfig } from './daytona-adapter'
import { DaytonaSandboxPlugin } from './DaytonaSandboxPlugin'

class RpcSmokeError extends Schema.TaggedErrorClass<RpcSmokeError>()('RpcSmokeError', {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

function required(name: string) {
  const value = process.env[name]
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`)
  }
  return value
}

const smokeEnv = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
)
const envProvider = ConfigProvider.layer(ConfigProvider.fromEnv({ env: smokeEnv }))

function sleep(ms: number) {
  return Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, ms)))
}

const program = Effect.gen(function* () {
  const sandbox = yield* SandboxService
  const repositoryUrl = required('PATCHPLANE_SMOKE_REPOSITORY_URL')
  const repositoryFullName = process.env.PATCHPLANE_SMOKE_REPOSITORY_FULL_NAME ?? 'patchplane/smoke'
  const provider = process.env.PATCHPLANE_PI_PROVIDER ?? 'openai'
  const model = process.env.PATCHPLANE_PI_MODEL ?? 'gpt-5.5'
  const traceId = `smoke-rpc-${Date.now()}`
  const observedEvents: SandboxRuntimeEvent[] = []

  const result = yield* sandbox.runRepositoryAgent({
    repositoryUrl,
    repositoryFullName,
    prompt: process.env.PATCHPLANE_SMOKE_PROMPT ?? 'Say hello, inspect the repository briefly, then stop.',
    provider,
    model,
    mode: 'rpc',
    timeoutSeconds: Number(process.env.PATCHPLANE_SMOKE_TIMEOUT_SECONDS ?? 120),
    traceId,
    onRuntimeSessionStarted: (session) =>
      Effect.sync(() => {
        console.log(JSON.stringify({ type: 'runtime_session_started', ...session }))
      }),
    onRuntimeEvents: (events) =>
      Effect.sync(() => {
        observedEvents.push(...events)
        for (const event of events) {
          console.log(JSON.stringify({ type: 'runtime_event', eventType: event.type, summary: event.summary }))
        }
      }),
  })

  console.log(JSON.stringify({
    type: 'sandbox_result',
    provider: result.provider,
    sandboxId: result.sandboxId,
    sessionId: result.sessionId,
    commandId: result.commandId,
    exitCode: result.exitCode,
    runtimeEventCount: result.runtimeEvents?.length ?? 0,
  }))

  if (result.sessionId === undefined || result.commandId === undefined) {
    return yield* new RpcSmokeError({ message: 'RPC smoke did not return a Daytona runtime session' })
  }

  const controlInput = {
    sandboxId: result.sandboxId,
    sessionId: result.sessionId,
    commandId: result.commandId,
    traceId,
  }

  yield* sleep(Number(process.env.PATCHPLANE_SMOKE_AFTER_PROMPT_WAIT_MS ?? 5_000))

  const steer = yield* sandbox.steerRuntimeSession({
    ...controlInput,
    message: process.env.PATCHPLANE_SMOKE_STEER_MESSAGE ?? 'Keep the answer short and report what you are doing.',
  })
  yield* sleep(Number(process.env.PATCHPLANE_SMOKE_AFTER_STEER_WAIT_MS ?? 2_000))

  const followUp = yield* sandbox.followUpRuntimeSession({
    ...controlInput,
    message: process.env.PATCHPLANE_SMOKE_FOLLOW_UP_MESSAGE ?? 'After the current turn, summarize the repository in one sentence.',
  })
  yield* sleep(Number(process.env.PATCHPLANE_SMOKE_AFTER_FOLLOW_UP_WAIT_MS ?? 2_000))

  const abort = yield* sandbox.abortRuntimeSession(controlInput)
  yield* sleep(Number(process.env.PATCHPLANE_SMOKE_AFTER_ABORT_WAIT_MS ?? 2_000))

  const terminate = yield* sandbox.terminateRuntimeSession(controlInput)
  yield* sleep(Number(process.env.PATCHPLANE_SMOKE_AFTER_TERMINATE_WAIT_MS ?? 1_000))

  const deleteSandbox = yield* Effect.gen(function* () {
    if (process.env.PATCHPLANE_SMOKE_DELETE_SANDBOX === 'false') return { status: 'skipped' as const }
    const daytonaConfig = yield* DaytonaConfig
    const daytona = new Daytona(toDaytonaClientConfig(daytonaConfig))
    return yield* Effect.acquireUseRelease(
      Effect.succeed(daytona),
      (client) => Effect.tryPromise({
        try: async () => {
          const retainedSandbox = await client.get(result.sandboxId)
          await retainedSandbox.delete(Number(process.env.PATCHPLANE_SMOKE_DELETE_TIMEOUT_SECONDS ?? 120))
          return { status: 'deleted' as const }
        },
        catch: (cause) => new RpcSmokeError({ message: 'Daytona smoke sandbox cleanup failed', cause }),
      }),
      (client) => Effect.tryPromise({
        try: () => client[Symbol.asyncDispose]?.() ?? Promise.resolve(),
        catch: (cause) => new RpcSmokeError({ message: 'Daytona smoke client disposal failed', cause }),
      }).pipe(Effect.ignore),
    )
  })
  console.log(JSON.stringify({ type: 'sandbox_cleanup', sandboxId: result.sandboxId, status: deleteSandbox.status }))

  const combinedEvents = [...(result.runtimeEvents ?? []), ...observedEvents]
  const summary = {
    type: 'rpc_smoke_summary',
    sessionStarted: true,
    commandResponses: combinedEvents.filter((event) => event.type.startsWith('pi.rpc.response.')).map((event) => event.type),
    runtimeEventTypes: combinedEvents.filter((event) => !event.type.startsWith('pi.rpc.response.')).map((event) => event.type),
    getStateResponse: combinedEvents.some((event) => event.type === 'pi.rpc.response.get_state.success'),
    promptResponse: combinedEvents.some((event) => event.type === 'pi.rpc.response.prompt.success'),
    hasRuntimeEvents: combinedEvents.some((event) => !event.type.startsWith('pi.rpc.response.')),
    steerSent: steer.status === 'sent',
    steerResponse: combinedEvents.some((event) => event.type === 'pi.rpc.response.steer.success'),
    followUpSent: followUp.status === 'sent',
    followUpResponse: combinedEvents.some((event) => event.type === 'pi.rpc.response.follow_up.success'),
    abortSent: abort.status === 'sent',
    abortResponse: combinedEvents.some((event) => event.type === 'pi.rpc.response.abort.success'),
    terminated: terminate.status === 'terminated',
    sandboxDeleted: deleteSandbox.status === 'deleted',
  }
  console.log(JSON.stringify(summary))

  if (!summary.getStateResponse || !summary.promptResponse || !summary.hasRuntimeEvents) {
    return yield* new RpcSmokeError({ message: 'RPC smoke did not observe required get_state, prompt, and runtime events' })
  }
  if (
    !summary.steerSent || !summary.steerResponse ||
    !summary.followUpSent || !summary.followUpResponse ||
    !summary.abortSent || !summary.abortResponse ||
    !summary.terminated || !summary.sandboxDeleted
  ) {
    return yield* new RpcSmokeError({ message: 'RPC smoke controls did not all report success responses and termination' })
  }

  return summary
})

await Effect.runPromise(program.pipe(
  Effect.provide(DaytonaSandboxPlugin.layer),
  Effect.provide(envProvider),
)).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
