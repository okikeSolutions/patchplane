import { Crypto, Effect, Encoding, Schema } from 'effect'
import { WorkflowStateError } from '@patchplane/domain/errors'
import type { WorkflowRunId } from '@patchplane/domain/ids'
import {
  VerificationPlanRequirementV1,
  VerificationPlanSource,
} from '@patchplane/domain/verification'

export const verificationPlanMaxRequirements = 16
export const verificationPlanMaxArtifactsPerRequirement = 8
export const verificationPlanMaxCommandLength = 2_000
export const verificationPlanMaxTimeoutSeconds = 1_800

export interface VerificationPlanLayerV1 {
  readonly source: VerificationPlanSource
  readonly requirements: ReadonlyArray<VerificationPlanRequirementV1>
}

export interface ResolvedVerificationPlanV1 {
  readonly workflowRunId: WorkflowRunId
  readonly version: 'verification-plan-v1'
  readonly sources: ReadonlyArray<VerificationPlanSource>
  readonly requirements: ReadonlyArray<VerificationPlanRequirementV1>
  readonly digest: `sha256:${string}`
  readonly createdAt: number
}

function normalizeCanonicalJson(candidate: unknown): unknown {
  if (Array.isArray(candidate)) return candidate.map(normalizeCanonicalJson)
  if (candidate !== null && typeof candidate === 'object') {
    const entries = Object.entries(candidate).filter(
      ([, entry]) => entry !== undefined,
    )
    for (let index = 1; index < entries.length; index += 1) {
      const current = entries[index]
      if (current === undefined) continue
      let position = index - 1
      while (position >= 0) {
        const previous = entries[position]
        if (previous === undefined || previous[0] <= current[0]) break
        entries[position + 1] = previous
        position -= 1
      }
      entries[position + 1] = current
    }
    return Object.fromEntries(
      entries.map(([key, entry]) => [key, normalizeCanonicalJson(entry)]),
    )
  }
  return candidate
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeCanonicalJson(value))
}

function validateLayer(layer: VerificationPlanLayerV1) {
  const seen = new Set<string>()
  for (const requirement of layer.requirements) {
    if (seen.has(requirement.key)) {
      throw new Error(`duplicate requirement key ${requirement.key}`)
    }
    seen.add(requirement.key)
    if (
      requirement.key !== requirement.key.trim() ||
      requirement.label !== requirement.label.trim() ||
      requirement.key.length > 128 ||
      requirement.label.length > 256 ||
      (requirement.command?.length ?? 0) > verificationPlanMaxCommandLength ||
      (requirement.timeoutSeconds ?? 0) > verificationPlanMaxTimeoutSeconds ||
      (requirement.architecture?.length ?? 0) > 128 ||
      new Set(requirement.requiredArtifactKinds).size !==
        requirement.requiredArtifactKinds.length ||
      requirement.requiredArtifactKinds.length >
        verificationPlanMaxArtifactsPerRequirement
    ) {
      throw new Error(`requirement ${requirement.key} exceeds plan limits`)
    }
  }
}

/**
 * Resolves trusted policy layers without reading candidate-controlled bytes.
 * System requirements are non-negotiable; workspace policy takes precedence
 * over base-repository policy for keys not owned by the system layer.
 */
export const ResolveVerificationPlanV1 = Effect.fn(
  '@patchplane/core/workflows/ResolveVerificationPlanV1',
)(function* (input: {
  readonly workflowRunId: WorkflowRunId
  readonly system: VerificationPlanLayerV1
  readonly workspace?: VerificationPlanLayerV1 | undefined
  readonly baseRepository?: VerificationPlanLayerV1 | undefined
  readonly createdAt: number
}) {
  const rawLayers = [
    input.system,
    input.workspace,
    input.baseRepository,
  ].filter((layer): layer is VerificationPlanLayerV1 => layer !== undefined)
  if (
    rawLayers.length > 3 ||
    rawLayers.some((layer) => layer.requirements.length > 16) ||
    new TextEncoder().encode(JSON.stringify(rawLayers)).byteLength > 65_536
  ) {
    return yield* new WorkflowStateError({
      message: 'Trusted verification plan input exceeds pre-decode limits',
    })
  }
  const layers = yield* Effect.forEach(rawLayers, (layer) =>
    Effect.all({
      source: Schema.decodeUnknownEffect(VerificationPlanSource)(layer.source),
      requirements: Schema.decodeUnknownEffect(
        Schema.Array(VerificationPlanRequirementV1),
      )(layer.requirements),
    }).pipe(
      Effect.mapError(
        () =>
          new WorkflowStateError({
            message: 'Trusted verification plan layer failed schema decoding',
          }),
      ),
    ),
  )
  if (
    layers[0]?.source.kind !== 'deployment-system' ||
    layers.some(
      (layer) =>
        layer.source.revision !== layer.source.revision.trim() ||
        layer.source.revision.length > 256 ||
        ('workspaceId' in layer.source &&
          layer.source.workspaceId.length > 256) ||
        ('repositoryFullName' in layer.source &&
          layer.source.repositoryFullName.length > 253),
    )
  ) {
    return yield* new WorkflowStateError({
      message:
        'Verification plan requires bounded canonical trusted source identities',
    })
  }

  const requirements = yield* Effect.try({
    try: () => {
      const resolved: Array<VerificationPlanRequirementV1> = []
      const keys = new Set<string>()
      for (const layer of layers) {
        validateLayer(layer)
        for (const requirement of layer.requirements) {
          if (keys.has(requirement.key)) continue
          keys.add(requirement.key)
          resolved.push(requirement)
        }
      }
      return resolved
    },
    catch: () =>
      new WorkflowStateError({
        message: 'Trusted verification plan is invalid or exceeds its limits',
      }),
  })
  if (requirements.length > verificationPlanMaxRequirements) {
    return yield* new WorkflowStateError({
      message: `Verification plan exceeds ${verificationPlanMaxRequirements} requirements`,
    })
  }

  const sources = layers.map((layer) => layer.source)
  const canonical = canonicalJson({
    version: 'verification-plan-v1',
    sources,
    requirements,
  })
  const crypto = yield* Crypto.Crypto
  const digest = yield* crypto
    .digest('SHA-256', new TextEncoder().encode(canonical))
    .pipe(
      Effect.mapError(
        () =>
          new WorkflowStateError({
            message: 'Failed to digest trusted verification plan',
          }),
      ),
    )

  return {
    workflowRunId: input.workflowRunId,
    version: 'verification-plan-v1' as const,
    sources,
    requirements,
    digest: `sha256:${Encoding.encodeHex(digest)}` as const,
    createdAt: input.createdAt,
  }
})
