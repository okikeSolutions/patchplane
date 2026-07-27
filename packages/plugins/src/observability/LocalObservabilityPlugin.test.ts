import { describe, expect, it } from '@effect/vitest'
import { NodeFileSystem } from '@effect/platform-node'
import { Crypto, Effect, FileSystem, Layer } from 'effect'
import { NodeCrypto } from '@effect/platform-node'
import { makeLocalObservabilityLayer } from './LocalObservabilityPlugin'

describe('LocalTestObservabilityPlugin', () => {
  it.effect('writes explicit test observability logs to effect.test.jsonl', () =>
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto
      const fs = yield* FileSystem.FileSystem
      const directory = yield* fs.makeTempDirectory({ prefix: 'patchplane-observability-' })
      const testLogFile = `${directory}/nested/logs/effect.test.jsonl`
      const marker = `patchplane-observability-test-${yield* crypto.randomUUIDv4}`

      yield* Effect.logInfo(marker).pipe(
        Effect.provide(makeLocalObservabilityLayer(testLogFile)),
      )

      expect(yield* fs.exists(testLogFile)).toBe(true)
      const contents = yield* fs.readFileString(testLogFile)
      expect(contents).toContain(marker)
    }).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodeCrypto.layer))),
  )
})
