import { readBackendConfigSync } from '../../src/config/schema'

export interface BootstrapConfigDefaults {
  readonly executionTargetKey: string
  readonly policyBundleKey: string
  readonly sandboxProvider: string
  readonly runtimeProvider: string
  readonly requiredReviewers: ReadonlyArray<string>
  readonly minimumScore: number
}

export function readBootstrapConfigDefaults(): BootstrapConfigDefaults {
  const config = readBackendConfigSync()

  return {
    executionTargetKey: config.github.defaultExecutionTargetKey,
    policyBundleKey: config.github.defaultPolicyBundleKey,
    sandboxProvider: config.sandbox.provider,
    runtimeProvider: config.runtime.provider,
    requiredReviewers: [...config.policy.requiredReviewers],
    minimumScore: config.policy.minimumScore,
  }
}
