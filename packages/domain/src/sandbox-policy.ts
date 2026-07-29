import { Schema } from 'effect'
import { PositiveFinite, PositiveInt } from './refinements'
/** Lifecycle controls for an isolated sandbox run. */
export const SandboxLifecyclePolicy = Schema.Struct({
  ephemeral: Schema.Boolean,
  retainAfterRun: Schema.Boolean,
  autoStopMinutes: Schema.optional(PositiveInt),
  autoArchiveMinutes: Schema.optional(Schema.Int),
  autoDeleteMinutes: Schema.optional(Schema.Int),
})
export type SandboxLifecyclePolicy = Schema.Schema.Type<
  typeof SandboxLifecyclePolicy
>

/** Network posture for an isolated sandbox run. */
export const SandboxNetworkPolicy = Schema.Struct({
  blockAll: Schema.optional(Schema.Boolean),
  allowList: Schema.optional(Schema.NonEmptyString),
})
export type SandboxNetworkPolicy = Schema.Schema.Type<
  typeof SandboxNetworkPolicy
>

/** Resource posture requested for an isolated sandbox run. */
export const SandboxResourcePolicy = Schema.Struct({
  cpu: Schema.optional(PositiveFinite),
  memoryGb: Schema.optional(PositiveFinite),
  diskGb: Schema.optional(PositiveFinite),
})
export type SandboxResourcePolicy = Schema.Schema.Type<
  typeof SandboxResourcePolicy
>

/** PatchPlane-owned sandbox policy metadata, normalized away from provider SDK shapes. */
export const SandboxPolicy = Schema.Struct({
  lifecycle: SandboxLifecyclePolicy,
  network: SandboxNetworkPolicy,
  resources: SandboxResourcePolicy,
  timeoutSeconds: Schema.optional(PositiveInt),
})
export type SandboxPolicy = Schema.Schema.Type<typeof SandboxPolicy>

export const decodeSandboxPolicy = Schema.decodeUnknownEffect(SandboxPolicy)
