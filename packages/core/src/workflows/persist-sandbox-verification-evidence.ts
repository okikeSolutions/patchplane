import { Effect } from 'effect'
import type { CandidatePatchSet } from '@patchplane/domain/decision-review'
import { SandboxError } from '@patchplane/domain/errors'
import type { EvidenceArtifact, EvidenceArtifactKind } from '@patchplane/domain/evidence-artifact'
import type { WorkflowRunId } from '@patchplane/domain/ids'
import type { SandboxExecution } from '@patchplane/domain/sandbox-execution'
import type { VerificationPlatform, VerificationRequirement, VerificationResult } from '@patchplane/domain/verification'
import type { SandboxCommandResult, SandboxVerificationResult } from '../services/sandbox-service'
import { StorageService } from '../services/storage-service'
import type { TelemetryContextFields } from '../services/telemetry-service'

export const PersistConfiguredVerificationRequirements = Effect.fn(
  '@patchplane/core/workflows/PersistConfiguredVerificationRequirements',
)(function*(input: TelemetryContextFields & {
  readonly workflowRunId: WorkflowRunId
  readonly testCommand?: string | undefined
  readonly testPlatform?: VerificationPlatform | undefined
  readonly browserCommand?: string | undefined
  readonly createdAt: number
}) {
  const storage = yield* StorageService
  const configured = configuredVerificationDefinitions(input)
  return yield* Effect.forEach(configured, (requirement) =>
    storage.recordVerificationRequirement({
      workflowRunId: input.workflowRunId,
      ...requirement,
      required: true,
      source: 'policy',
      createdAt: input.createdAt,
      traceId: input.traceId,
      pluginName: input.pluginName,
      operation: 'persistConfiguredVerificationRequirements.recordRequirement',
    })
  )
})

export function configuredVerificationDefinitions(input: {
  readonly testCommand?: string | undefined
  readonly testPlatform?: VerificationPlatform | undefined
  readonly browserCommand?: string | undefined
}) {
  return [
    ...(input.testCommand === undefined || input.testCommand.trim().length === 0 ? [] : [{
      key: 'sandbox:test',
      label: 'Configured test verification',
      kind: 'test' as const,
      command: input.testCommand,
      platform: input.testPlatform ?? 'linux',
      requiredArtifactKinds: ['test-report' as const],
    }]),
    ...(input.browserCommand === undefined || input.browserCommand.trim().length === 0 ? [] : [{
      key: 'sandbox:browser',
      label: 'Configured browser verification',
      kind: 'browser' as const,
      command: input.browserCommand,
      platform: 'linux' as const,
      requiredArtifactKinds: ['screenshot' as const],
    }]),
  ]
}

/** Persists configured sandbox checks as candidate-bound verification evidence. */
export const PersistSandboxVerificationEvidence = Effect.fn(
  '@patchplane/core/workflows/PersistSandboxVerificationEvidence',
)(function*(input: TelemetryContextFields & {
  readonly workflowRunId: WorkflowRunId
  readonly sandboxExecution: SandboxExecution
  readonly candidatePatchSet: CandidatePatchSet
  readonly evidenceArtifacts: ReadonlyArray<EvidenceArtifact>
  readonly sandboxResult: SandboxCommandResult
  readonly verificationRequirements: ReadonlyArray<VerificationRequirement>
}) {
  const storage = yield* StorageService
  const candidateDigest = input.candidatePatchSet.candidateDigest
  const transientResults = input.sandboxResult.verificationResults ?? []

  if (candidateDigest === undefined) {
    return { requirements: input.verificationRequirements, results: [] }
  }

  const records = yield* Effect.forEach(transientResults, (transient, index) =>
    Effect.gen(function* () {
      const requiredArtifactKind = artifactKindFor(transient.kind)
      const artifacts = input.evidenceArtifacts.filter((artifact) => artifact.kind === requiredArtifactKind)
      const requirement = input.verificationRequirements.find(
        (candidateRequirement) => candidateRequirement.key === `sandbox:${transient.kind}`,
      )
      if (requirement === undefined) {
        return yield* new SandboxError({
          operation: 'persistSandboxVerificationEvidence.matchRequirement',
          message: `Sandbox returned unconfigured ${transient.kind} verification evidence`,
          cause: undefined,
        })
      }

      const candidateUnchanged =
        transient.candidateDigestBefore !== undefined &&
        transient.candidateDigestBefore === transient.candidateDigestAfter &&
        transient.candidateDigestAfter === input.sandboxResult.candidateStateDigest &&
        input.sandboxResult.candidateStateDigest === candidateDigest
      const status = deriveDurableVerificationStatus(transient, candidateUnchanged, artifacts.length > 0)
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
        ...(transient.exitCode === undefined ? {} : { exitCode: transient.exitCode }),
        ...(transient.message === undefined ? {} : { summary: transient.message }),
        artifactIds: artifacts.map((artifact) => artifact.id),
        producedArtifactKinds: artifacts.map((artifact) => artifact.kind),
        candidateDigestBefore: transient.candidateDigestBefore ?? 'unavailable',
        ...(transient.candidateDigestAfter === undefined
          ? {}
          : { candidateDigestAfter: transient.candidateDigestAfter }),
        startedAt: transient.startedAt ?? input.sandboxExecution.startedAt,
        completedAt: transient.completedAt ?? input.sandboxExecution.completedAt,
        idempotencyKey: `${input.candidatePatchSet.id}:${requirement.key}:${index}`,
        traceId: input.traceId,
        pluginName: input.pluginName,
        operation: 'persistSandboxVerificationEvidence.recordResult',
      })
      return { requirement, result }
    }),
  )

  const blockedResults = yield* Effect.forEach(
    input.verificationRequirements.filter((requirement) =>
      requirement.required &&
      requirement.platform !== undefined &&
      requirement.platform !== 'linux' &&
      !records.some((record) => record.requirement.id === requirement.id)
    ),
    (requirement) => storage.recordVerificationResult({
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
      operation: 'persistSandboxVerificationEvidence.recordBlockedPlatformResult',
    }),
  )

  return {
    requirements: input.verificationRequirements,
    results: [...records.map((record) => record.result), ...blockedResults],
  }
})

function artifactKindFor(kind: SandboxVerificationResult['kind']): EvidenceArtifactKind {
  return kind === 'test' ? 'test-report' : 'screenshot'
}

export function deriveDurableVerificationStatus(
  result: SandboxVerificationResult,
  candidateUnchanged: boolean,
  requiredArtifactPresent: boolean,
): VerificationResult['status'] {
  if (!candidateUnchanged) return 'invalidated'
  if (result.status === 'failed') {
    return result.exitCode === undefined || result.exitCode === 0 ? 'error' : 'failed'
  }
  if (!requiredArtifactPresent) return 'error'
  return result.exitCode === 0 ? 'passed' : 'error'
}
