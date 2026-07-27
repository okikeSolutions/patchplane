import { Layer, ManagedRuntime } from 'effect'

const diffProjectionMemoMap = Layer.makeMemoMapUnsafe()

export const diffProjectionRuntime = ManagedRuntime.make(Layer.empty, {
  memoMap: diffProjectionMemoMap,
})

export function disposeDiffProjectionRuntime() {
  return diffProjectionRuntime.dispose()
}
