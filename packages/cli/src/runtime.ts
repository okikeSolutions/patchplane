import { Layer, ManagedRuntime } from 'effect'
import { NodeServices } from '@effect/platform-node'
import { CliConfigFile } from './services/config-file'
import { CliDiagnostics } from './services/diagnostics'
import { CliEnvFile } from './services/env-file'
import { CliInteractivity, CliInteractivityLive } from './services/interactivity'

const BaseCliLayer = Layer.mergeAll(
  CliInteractivityLive,
  CliEnvFile.Live,
  CliConfigFile.Live,
).pipe(
  Layer.provideMerge(NodeServices.layer),
)

export const CliLayer = CliDiagnostics.Live.pipe(
  Layer.provideMerge(BaseCliLayer),
)

export const cliRuntime = ManagedRuntime.make(CliLayer)

export type CliRuntimeServices =
  | NodeServices.NodeServices
  | CliInteractivity
  | CliEnvFile
  | CliConfigFile
  | CliDiagnostics
