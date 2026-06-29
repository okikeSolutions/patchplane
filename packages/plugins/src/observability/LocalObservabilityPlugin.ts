import { NodeFileSystem } from '@effect/platform-node'
import { Effect, Layer, Logger, Path } from 'effect'

export const effectLogFile = new URL('../../../../.patchplane/logs/effect.jsonl', import.meta.url).pathname
export const effectTestLogFile = new URL('../../../../.patchplane/logs/effect.test.jsonl', import.meta.url).pathname

export function makeLocalObservabilityLayer(file = effectLogFile) {
  return Layer.unwrap(
    Effect.gen(function* () {
      const path = yield* Path.Path
      const logFile = path.resolve(file)
      return Logger.layer([
        Logger.tracerLogger,
        Logger.consolePretty({ colors: true }),
        Logger.formatJson.pipe(
          Logger.toFile(logFile, {
            flag: 'a',
          }),
        ),
      ])
    }),
  ).pipe(Layer.provide(Layer.mergeAll(NodeFileSystem.layer, Path.layer)))
}

export const LocalObservabilityPlugin = {
  layer: makeLocalObservabilityLayer(effectLogFile),
} as const

export const LocalTestObservabilityPlugin = {
  layer: makeLocalObservabilityLayer(effectTestLogFile),
} as const
