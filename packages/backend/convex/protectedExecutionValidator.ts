import { v } from 'convex/values'

/** Shared fields for the security-sensitive protected execution gate. */
export const protectedExecutionPolicyFields = {
  version: v.literal('linux-v1'),
  effectiveUid: v.number(),
  effectiveGid: v.number(),
  noNewPrivileges: v.literal(true),
  capabilitySetsCleared: v.literal(true),
  sourceReadOnly: v.literal(true),
  gitMetadataReadOnly: v.literal(true),
  privatePidNamespace: v.literal(true),
  privateNetworkNamespace: v.literal(true),
  nestedNamespaceCreationBlocked: v.literal(true),
  descendantsTerminated: v.literal(true),
} as const

export const protectedExecutionPolicyValidator = v.object(
  protectedExecutionPolicyFields,
)

/** Historical rows predate nested-namespace attestation and remain readable only. */
export const historicalProtectedExecutionPolicyValidator = v.object({
  ...protectedExecutionPolicyFields,
  nestedNamespaceCreationBlocked: v.optional(v.literal(true)),
})
