import { Crypto, Effect, Layer, ManagedRuntime } from 'effect'
import { makeAppLayer } from './app-layer'

const patchPlaneMemoMap = Layer.makeMemoMapUnsafe()

export const patchPlaneRuntime = ManagedRuntime.make(makeAppLayer(), {
  memoMap: patchPlaneMemoMap,
})

export function disposePatchPlaneRuntime() {
  return patchPlaneRuntime.dispose()
}

export function randomTraceId() {
  return patchPlaneRuntime.runPromise(
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto
      return yield* crypto.randomUUIDv4
    }),
  )
}

if (typeof process !== 'undefined' && process.release?.name === 'node') {
  const disposeRuntime = () => {
    void disposePatchPlaneRuntime()
  }

  process.once('SIGINT', disposeRuntime)
  process.once('SIGTERM', disposeRuntime)
}
