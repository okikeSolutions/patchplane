import { Schema } from 'effect'
import { EpochMillis } from './refinements'
import { SandboxPolicy } from './sandbox-policy'

const boundedNonEmpty = (maximum: number) =>
  Schema.String.check(Schema.isLengthBetween(1, maximum))

/** Provider settings read back after the sandbox reached its running state. */
export const SandboxEnvironmentIdentity = Schema.Struct({
  sandboxClass: boundedNonEmpty(128),
  sandboxClassSource: Schema.Literal('trusted-request'),
  operatingSystem: boundedNonEmpty(128),
  architecture: boundedNonEmpty(128),
  image: boundedNonEmpty(512),
  target: boundedNonEmpty(256),
  providerState: boundedNonEmpty(128),
  public: Schema.Boolean,
  linked: Schema.Boolean,
  volumeCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  observedAt: EpochMillis,
})
export type SandboxEnvironmentIdentity = Schema.Schema.Type<
  typeof SandboxEnvironmentIdentity
>

export const EffectiveSandboxPolicy = Schema.Struct({
  ...SandboxPolicy.fields,
  environment: SandboxEnvironmentIdentity,
})
export type EffectiveSandboxPolicy = Schema.Schema.Type<
  typeof EffectiveSandboxPolicy
>
