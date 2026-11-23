import * as Cloudflare from '@alchemy.run/cloudflare'
import type { RuntimeContext } from 'alchemy/RuntimeContext'
import { type Effect, Schema } from 'effect'

export interface ControlPlaneWakeResult {
  readonly ok: boolean
  readonly trigger: string
  readonly wokenAt: number
}

/** Stable public error code; causes are logged, never returned to callers. */
export const CONTROL_PLANE_UNAVAILABLE = 'control_plane_unavailable'

export class ControlPlaneWakeError extends Schema.TaggedError<
  ControlPlaneWakeError,
  { readonly brand: unique symbol }
>()('ControlPlaneWakeError', {
  trigger: Schema.NonEmptyString,
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export type ControlPlaneContainerShape = {
  readonly wake: (
    trigger: string,
  ) => Effect.Effect<
    ControlPlaneWakeResult,
    ControlPlaneWakeError,
    RuntimeContext
  >
}

export class ControlPlaneContainer extends Cloudflare.Containers.Container<
  ControlPlaneContainer,
  ControlPlaneContainerShape
>()('ControlPlaneContainer') {}
