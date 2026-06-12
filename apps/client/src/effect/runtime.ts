import { Layer, ManagedRuntime } from 'effect'
import { PatchPlaneLayer } from './layers'

export const appMemoMap = Layer.makeMemoMapUnsafe()

export const patchPlaneRuntime = ManagedRuntime.make(PatchPlaneLayer, {
  memoMap: appMemoMap,
})
