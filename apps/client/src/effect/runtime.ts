import { Layer, ManagedRuntime } from 'effect'
import { PatchPlaneLayer } from './layers'

const patchPlaneMemoMap = Layer.makeMemoMapUnsafe()

export const patchPlaneRuntime = ManagedRuntime.make(PatchPlaneLayer, {
  memoMap: patchPlaneMemoMap,
})

export function disposePatchPlaneRuntime() {
  return patchPlaneRuntime.dispose()
}

if (typeof process !== 'undefined' && process.release?.name === 'node') {
  const disposeRuntime = () => {
    void disposePatchPlaneRuntime()
  }

  process.once('SIGINT', disposeRuntime)
  process.once('SIGTERM', disposeRuntime)
}
