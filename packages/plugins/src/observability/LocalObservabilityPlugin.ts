import { NodeFileSystem } from '@effect/platform-node'
import { Layer, Logger } from 'effect'

export const effectLogFile = '../../.patchplane/logs/effect.jsonl'
export const effectTestLogFile = '../../.patchplane/logs/effect.test.jsonl'

export function makeLocalObservabilityLayer(file = effectLogFile) {
  return Logger.layer([
    Logger.tracerLogger,
    Logger.consolePretty({ colors: true }),
    Logger.formatJson.pipe(
      Logger.toFile(file, {
        flag: 'a',
      }),
    ),
  ]).pipe(Layer.provide(NodeFileSystem.layer))
}

export const LocalObservabilityPlugin = {
  layer: makeLocalObservabilityLayer(effectLogFile),
} as const

export const LocalTestObservabilityPlugin = {
  layer: makeLocalObservabilityLayer(effectTestLogFile),
} as const
