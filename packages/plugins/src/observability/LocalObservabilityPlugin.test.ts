import { describe, expect, it } from '@effect/vitest'
import { NodeFileSystem } from '@effect/platform-node'
import { Crypto, Effect, FileSystem, Layer } from 'effect'
import { NodeCrypto } from '@effect/platform-node'
import {
  effectTestLogFile,
  LocalTestObservabilityPlugin,
} from './LocalObservabilityPlugin'

describe('LocalTestObservabilityPlugin', () => {
  it.effect('writes explicit test observability logs to effect.test.jsonl', () =>
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto
      const marker = `patchplane-observability-test-${yield* crypto.randomUUIDv4}`

      yield* Effect.logInfo(marker).pipe(
        Effect.provide(LocalTestObservabilityPlugin.layer),
      )

      const fs = yield* FileSystem.FileSystem
      expect(yield* fs.exists(effectTestLogFile)).toBe(true)
      const contents = yield* fs.readFileString(effectTestLogFile)
      expect(contents).toContain(marker)
    }).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodeCrypto.layer))),
  )
})
