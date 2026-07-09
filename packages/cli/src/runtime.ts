import { Layer } from 'effect'
import { NodeServices } from '@effect/platform-node'
import { CliConfigFile } from './services/config-file'
import { CliDiagnostics } from './services/diagnostics'
import { CliEnvFile } from './services/env-file'
import { CliGlobalOptions, type CliGlobalOptionsValue } from './services/global-options'
import { CliInteractivityLive } from './services/interactivity'

const makeBaseCliLayer = (globalOptionsLayer: Layer.Layer<CliGlobalOptions, never, any>) =>
  Layer.mergeAll(
    CliInteractivityLive,
    CliEnvFile.Live,
    CliConfigFile.Live,
  ).pipe(
    Layer.provideMerge(globalOptionsLayer),
    Layer.provideMerge(NodeServices.layer),
  )

const BaseCliLayer = makeBaseCliLayer(CliGlobalOptions.Live)

export const CliLayer = CliDiagnostics.Live.pipe(
  Layer.provideMerge(BaseCliLayer),
)

export function makeCliLayer(options: CliGlobalOptionsValue) {
  return CliDiagnostics.Live.pipe(
    Layer.provideMerge(makeBaseCliLayer(CliGlobalOptions.layer(options))),
  )
}
