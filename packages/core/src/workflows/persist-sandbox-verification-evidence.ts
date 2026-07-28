import { Crypto, Effect, Encoding } from 'effect'
import type { CandidatePatchSet } from '@patchplane/domain/decision-review'
import { SandboxError } from '@patchplane/domain/errors'
import type { EvidenceArtifact } from '@patchplane/domain/evidence-artifact'
import type { WorkflowRunId } from '@patchplane/domain/ids'
import type { SandboxExecution } from '@patchplane/domain/sandbox-execution'
import type {
  VerificationPlanV1,
  VerificationPlatform,
  VerificationRequirement,
  VerificationResult,
} from '@patchplane/domain/verification'
import type {
  SandboxCommandResult,
  SandboxVerificationResult,
} from '../services/sandbox-service'
import { StorageService } from '../services/storage-service'
import type { TelemetryContextFields } from '../services/telemetry-service'
import {
  ResolveVerificationPlanV1,
  type VerificationPlanLayerV1,
} from './resolve-verification-plan-v1'

const persistedVerificationPlanBrand: unique symbol = Symbol(
  '@patchplane/core/PersistedVerificationPlanV1',
)
const issuedVerificationPlans = new WeakSet<object>()
export interface PersistedVerificationPlanV1 {
  readonly plan: VerificationPlanV1
  readonly requirements: ReadonlyArray<VerificationRequirement>
  readonly [persistedVerificationPlanBrand]: true
}

export function isPersistedVerificationPlanV1(
  value: unknown,
): value is PersistedVerificationPlanV1 {
  return (
    typeof value === 'object' &&
    value !== null &&
    issuedVerificationPlans.has(value)
  )
}

function issuePersistedVerificationPlanV1(
  plan: VerificationPlanV1,
  requirements: ReadonlyArray<VerificationRequirement>,
): PersistedVerificationPlanV1 {
  const capability = Object.freeze({
    plan: Object.freeze({
      ...plan,
      sources: Object.freeze(
        plan.sources.map((source) => Object.freeze({ ...source })),
      ),
      requirements: Object.freeze(
        plan.requirements.map((requirement) =>
          Object.freeze({
            ...requirement,
            requiredArtifactKinds: Object.freeze([
              ...requirement.requiredArtifactKinds,
            ]),
          }),
        ),
      ),
    }),
    requirements: Object.freeze(
      requirements.map((requirement) =>
        Object.freeze({
          ...requirement,
          requiredArtifactKinds: Object.freeze([
            ...requirement.requiredArtifactKinds,
          ]),
        }),
      ),
    ),
    [persistedVerificationPlanBrand]: true as const,
  })
  issuedVerificationPlans.add(capability)
  return capability
}

export const PersistConfiguredVerificationRequirements = Effect.fn(
  '@patchplane/core/workflows/PersistConfiguredVerificationRequirements',
)(function* (
  input: TelemetryContextFields & {
    readonly workflowRunId: WorkflowRunId
    readonly testCommand?: string | undefined
    readonly testPlatform?: VerificationPlatform | undefined
    readonly browserCommand?: string | undefined
    readonly timeoutSeconds?: number | undefined
    readonly policyRevision?: string | undefined
    readonly workspacePolicy?: VerificationPlanLayerV1 | undefined
    readonly baseRepositoryPolicy?: VerificationPlanLayerV1 | undefined
    readonly createdAt: number
  },
) {
  const storage = yield* StorageService
  const configured = configuredVerificationDefinitions(input).map(
    (requirement) => ({ ...requirement, required: true }),
  )
  const crypto = yield* Crypto.Crypto
  const policyRevision =
    input.policyRevision ??
    `sha256:${Encoding.encodeHex(
      yield* crypto.digest(
        'SHA-256',
        new TextEncoder().encode(
          JSON.stringify({
            source: 'deployment-environment',
            requirements: configured,
          }),
        ),
      ),
    )}`
  const resolved = yield* ResolveVerificationPlanV1({
    workflowRunId: input.workflowRunId,
    system: {
      source: {
        kind: 'deployment-system',
        revision: policyRevision,
      },
      requirements: configured,
    },
    workspace: input.workspacePolicy,
    baseRepository: input.baseRepositoryPolicy,
    createdAt: input.createdAt,
  })
  const plan = yield* storage.recordVerificationPlan({
    ...resolved,
    traceId: input.traceId,
    pluginName: input.pluginName,
    operation: 'persistConfiguredVerificationRequirements.recordPlan',
  })
  const requirements = yield* Effect.forEach(
    resolved.requirements,
    (requirement) =>
      storage.recordVerificationRequirement({
        workflowRunId: input.workflowRunId,
        verificationPlanId: plan.id,
        ...requirement,
        source: 'policy',
        createdAt: plan.createdAt,
        traceId: input.traceId,
        pluginName: input.pluginName,
        operation:
          'persistConfiguredVerificationRequirements.recordRequirement',
      }),
  )
  return issuePersistedVerificationPlanV1(plan, requirements)
})

export const PersistLegacyConfiguredVerificationRequirements = Effect.fn(
  '@patchplane/core/workflows/PersistLegacyConfiguredVerificationRequirements',
)(function* (
  input: TelemetryContextFields & {
    readonly workflowRunId: WorkflowRunId
    readonly testCommand?: string | undefined
    readonly testPlatform?: VerificationPlatform | undefined
    readonly browserCommand?: string | undefined
    readonly timeoutSeconds?: number | undefined
    readonly createdAt: number
  },
) {
  const storage = yield* StorageService
  return yield* Effect.forEach(
    configuredVerificationDefinitions(input),
    (requirement) =>
      storage.recordVerificationRequirement({
        workflowRunId: input.workflowRunId,
        ...requirement,
        required: true,
        source: 'policy',
        createdAt: input.createdAt,
        traceId: input.traceId,
        pluginName: input.pluginName,
        operation:
          'persistLegacyConfiguredVerificationRequirements.recordRequirement',
      }),
  )
})

export function configuredVerificationDefinitions(input: {
  readonly testCommand?: string | undefined
  readonly testPlatform?: VerificationPlatform | undefined
  readonly browserCommand?: string | undefined
  readonly timeoutSeconds?: number | undefined
}) {
  return [
    ...(input.testCommand === undefined || input.testCommand.trim().length === 0
      ? []
      : [
          {
            key: 'sandbox:test',
            label: 'Configured test verification',
            kind: 'test' as const,
            command: input.testCommand,
            platform: input.testPlatform ?? 'linux',
            ...(input.timeoutSeconds === undefined
              ? {}
              : { timeoutSeconds: input.timeoutSeconds }),
            requiredArtifactKinds: ['test-report' as const],
          },
        ]),
    ...(input.browserCommand === undefined ||
    input.browserCommand.trim().length === 0
      ? []
      : [
          {
            key: 'sandbox:browser',
            label: 'Configured browser verification',
            kind: 'browser' as const,
            command: input.browserCommand,
            platform: 'linux' as const,
            ...(input.timeoutSeconds === undefined
              ? {}
              : { timeoutSeconds: input.timeoutSeconds }),
            requiredArtifactKinds: ['screenshot' as const],
          },
        ]),
  ]
}

/** Persists configured sandbox checks as candidate-bound verification evidence. */
export const PersistSandboxVerificationEvidence = Effect.fn(
  '@patchplane/core/workflows/PersistSandboxVerificationEvidence',
)(function* (
  input: TelemetryContextFields & {
    readonly workflowRunId: WorkflowRunId
    readonly sandboxExecution: SandboxExecution
    readonly candidatePatchSet: CandidatePatchSet
    readonly evidenceArtifacts: ReadonlyArray<EvidenceArtifact>
    readonly sandboxResult: SandboxCommandResult
    readonly verificationRequirements: ReadonlyArray<VerificationRequirement>
  },
) {
  const storage = yield* StorageService
  const candidateDigest = input.candidatePatchSet.candidateDigest
  const transientResults = input.sandboxResult.verificationResults ?? []
  if (
    input.candidatePatchSet.subject?.kind === 'incoming-pull-request' &&
    transientResults.length > 0
  ) {
    return yield* new SandboxError({
      operation: 'persistSandboxVerificationEvidence.rejectIncomingResults',
      message:
        'Incoming PR verification results require a trusted fresh execution group',
      cause: undefined,
    })
  }

  if (candidateDigest === undefined) {
    return { requirements: input.verificationRequirements, results: [] }
  }

  const records = yield* Effect.forEach(transientResults, (transient, index) =>
    Effect.gen(function* () {
      const requirement = input.verificationRequirements.find(
        (candidateRequirement) =>
          candidateRequirement.key ===
          (transient.requirementKey ?? `sandbox:${transient.kind}`),
      )
      if (requirement === undefined) {
        return yield* new SandboxError({
          operation: 'persistSandboxVerificationEvidence.matchRequirement',
          message: `Sandbox returned unconfigured ${transient.kind} verification evidence`,
          cause: undefined,
        })
      }

      const artifacts = input.evidenceArtifacts.filter((artifact) =>
        requirement.requiredArtifactKinds.includes(artifact.kind),
      )
      const requiredArtifactsPresent =
        requirement.requiredArtifactKinds.length === 0 ||
        requirement.requiredArtifactKinds.every((kind) =>
          artifacts.some((artifact) => artifact.kind === kind),
        )
      const localCandidateUnchanged =
        transient.candidateDigestBefore !== undefined &&
        transient.candidateDigestBefore === transient.candidateDigestAfter &&
        transient.candidateDigestAfter ===
          input.sandboxResult.candidateStateDigest
      const incomingCandidate =
        input.candidatePatchSet.subject?.kind === 'incoming-pull-request'
      const candidateUnchanged = incomingCandidate
        ? localCandidateUnchanged &&
          input.sandboxResult.initialCandidateStateDigest !== undefined &&
          transient.candidateDigestBefore ===
            input.sandboxResult.initialCandidateStateDigest &&
          input.sandboxResult.baseSha === input.candidatePatchSet.headSha
        : localCandidateUnchanged &&
          input.sandboxResult.candidateStateDigest === candidateDigest
      const durableDigestBefore =
        incomingCandidate && candidateUnchanged
          ? candidateDigest
          : transient.candidateDigestBefore
      const durableDigestAfter =
        incomingCandidate && candidateUnchanged
          ? candidateDigest
          : transient.candidateDigestAfter
      const status = deriveDurableVerificationStatus(
        transient,
        candidateUnchanged,
        requiredArtifactsPresent,
      )
      const result = yield* storage.recordVerificationResult({
        workflowRunId: input.workflowRunId,
        requirementId: requirement.id,
        candidatePatchSetId: input.candidatePatchSet.id,
        sandboxExecutionId: input.sandboxExecution.id,
        provider: transient.provider ?? input.sandboxResult.provider,
        command: transient.command,
        platform: transient.platform ?? 'linux',
        architecture: transient.architecture ?? 'unknown',
        status,
        ...(transient.exitCode === undefined
          ? {}
          : { exitCode: transient.exitCode }),
        ...(transient.message === undefined
          ? {}
          : { summary: transient.message }),
        artifactIds: artifacts.map((artifact) => artifact.id),
        producedArtifactKinds: artifacts.map((artifact) => artifact.kind),
        ...(durableDigestBefore === undefined
          ? {}
          : { candidateDigestBefore: durableDigestBefore }),
        ...(durableDigestAfter === undefined
          ? {}
          : { candidateDigestAfter: durableDigestAfter }),
        startedAt: transient.startedAt ?? input.sandboxExecution.startedAt,
        completedAt:
          transient.completedAt ?? input.sandboxExecution.completedAt,
        idempotencyKey: `${input.candidatePatchSet.id}:${requirement.key}:${index}`,
        traceId: input.traceId,
        pluginName: input.pluginName,
        operation: 'persistSandboxVerificationEvidence.recordResult',
      })
      return { requirement, result }
    }),
  )

  const blockedResults = yield* Effect.forEach(
    input.verificationRequirements.filter(
      (requirement) =>
        requirement.required &&
        requirement.platform !== undefined &&
        requirement.platform !== 'linux' &&
        !records.some((record) => record.requirement.id === requirement.id),
    ),
    (requirement) =>
      storage.recordVerificationResult({
        workflowRunId: input.workflowRunId,
        requirementId: requirement.id,
        candidatePatchSetId: input.candidatePatchSet.id,
        sandboxExecutionId: input.sandboxExecution.id,
        provider: input.sandboxResult.provider,
        command: requirement.command,
        platform: 'linux',
        architecture: 'unknown',
        status: 'blocked',
        summary: `Required ${requirement.platform} verification is unavailable in the Linux sandbox provider.`,
        artifactIds: [],
        producedArtifactKinds: [],
        candidateDigestBefore: candidateDigest,
        candidateDigestAfter: candidateDigest,
        startedAt: input.sandboxExecution.startedAt,
        completedAt: input.sandboxExecution.completedAt,
        idempotencyKey: `${input.candidatePatchSet.id}:${requirement.key}:platform-blocked`,
        traceId: input.traceId,
        pluginName: input.pluginName,
        operation:
          'persistSandboxVerificationEvidence.recordBlockedPlatformResult',
      }),
  )

  return {
    requirements: input.verificationRequirements,
    results: [...records.map((record) => record.result), ...blockedResults],
  }
})

export function deriveDurableVerificationStatus(
  result: SandboxVerificationResult,
  candidateUnchanged: boolean,
  requiredArtifactPresent: boolean,
): VerificationResult['status'] {
  if (!candidateUnchanged) return 'invalidated'
  if (result.status === 'failed') {
    return result.exitCode === undefined || result.exitCode === 0
      ? 'error'
      : 'failed'
  }
  if (!requiredArtifactPresent) return 'error'
  return result.exitCode === 0 ? 'passed' : 'error'
}
