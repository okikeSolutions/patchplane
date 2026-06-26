import { NodeServices } from '@effect/platform-node'
import { Layer } from 'effect'
import { makePatchPlaneLayer } from './plugin-layers'

export const PatchPlaneLayer = Layer.mergeAll(
  makePatchPlaneLayer(),
  NodeServices.layer,
)
