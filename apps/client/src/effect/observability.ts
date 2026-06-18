import { NodeFileSystem } from '@effect/platform-node'
import { Layer, Logger } from 'effect'

const effectLogFile = '../../.patchplane/logs/effect.jsonl'

export const ObservabilityLayer = Logger.layer([
  Logger.tracerLogger,
  Logger.consolePretty({ colors: true }),
  Logger.formatJson.pipe(
    Logger.toFile(effectLogFile, {
      flag: 'a',
    }),
  ),
]).pipe(Layer.provide(NodeFileSystem.layer))
