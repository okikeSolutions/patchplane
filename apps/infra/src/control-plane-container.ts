import * as Cloudflare from '@alchemy.run/cloudflare'
import type { Effect } from 'effect'

export type ControlPlaneContainerShape = {
  readonly wake: (trigger: string) => Effect.Effect<{
    readonly ok: boolean
    readonly trigger: string
    readonly wokenAt: number
  }>
}

export class ControlPlaneContainer extends Cloudflare.Containers.Container<
  ControlPlaneContainer,
  ControlPlaneContainerShape
>()('ControlPlaneContainer') {}
