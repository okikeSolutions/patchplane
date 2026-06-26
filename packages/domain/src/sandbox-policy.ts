import { Schema } from 'effect'

/** Lifecycle controls for an isolated sandbox run. */
export const SandboxLifecyclePolicy = Schema.Struct({
  ephemeral: Schema.Boolean,
  retainAfterRun: Schema.Boolean,
  autoStopMinutes: Schema.optional(Schema.Number),
  autoArchiveMinutes: Schema.optional(Schema.Number),
  autoDeleteMinutes: Schema.optional(Schema.Number),
})
export type SandboxLifecyclePolicy = Schema.Schema.Type<typeof SandboxLifecyclePolicy>

/** Network posture for an isolated sandbox run. */
export const SandboxNetworkPolicy = Schema.Struct({
  blockAll: Schema.optional(Schema.Boolean),
  allowList: Schema.optional(Schema.String),
})
export type SandboxNetworkPolicy = Schema.Schema.Type<typeof SandboxNetworkPolicy>

/** Resource posture requested for an isolated sandbox run. */
export const SandboxResourcePolicy = Schema.Struct({
  cpu: Schema.optional(Schema.Number),
  memoryGb: Schema.optional(Schema.Number),
  diskGb: Schema.optional(Schema.Number),
})
export type SandboxResourcePolicy = Schema.Schema.Type<typeof SandboxResourcePolicy>

/** PatchPlane-owned sandbox policy metadata, normalized away from provider SDK shapes. */
export const SandboxPolicy = Schema.Struct({
  lifecycle: SandboxLifecyclePolicy,
  network: SandboxNetworkPolicy,
  resources: SandboxResourcePolicy,
  timeoutSeconds: Schema.optional(Schema.Number),
})
export type SandboxPolicy = Schema.Schema.Type<typeof SandboxPolicy>

export const decodeSandboxPolicy = Schema.decodeUnknownEffect(SandboxPolicy)
