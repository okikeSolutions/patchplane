import { Effect, Layer } from 'effect'
import {
  RuntimeAdapterService,
  SandboxAdapterService,
} from '@patchplane/domain'
import { BackendConfig, BackendConfigLive } from '../config/schema'
import { GitHubBoundaryLive } from '../github/layers'
import { PiMonoRuntimeAdapter } from '../runtime/piMono'
import { DaytonaSandboxAdapter } from '../sandbox/daytona'

const RuntimeAdapterLive = Layer.effect(
  RuntimeAdapterService,
  Effect.gen(function* () {
    const config = yield* BackendConfig

    return new PiMonoRuntimeAdapter({
      command: config.runtime.command,
    })
  }),
).pipe(Layer.provide(BackendConfigLive))

const SandboxAdapterLive = Layer.effect(
  SandboxAdapterService,
  Effect.gen(function* () {
    const config = yield* BackendConfig

    return new DaytonaSandboxAdapter({
      ...(config.sandbox.apiKey ? { apiKey: config.sandbox.apiKey } : {}),
      ...(config.sandbox.apiUrl ? { apiUrl: config.sandbox.apiUrl } : {}),
      ...(config.sandbox.target ? { target: config.sandbox.target } : {}),
      timeoutMs: config.sandbox.timeoutMs,
      autoStopIntervalMinutes: config.sandbox.autoStopIntervalMinutes,
      ephemeral: config.sandbox.ephemeral,
    })
  }),
).pipe(Layer.provide(BackendConfigLive))

export const ExecutionBoundaryLive = Layer.mergeAll(
  BackendConfigLive,
  GitHubBoundaryLive,
  RuntimeAdapterLive,
  SandboxAdapterLive,
)
