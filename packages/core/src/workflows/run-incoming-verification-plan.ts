import { Clock, Crypto, Effect, Encoding, Option, Schema } from 'effect'
import { SandboxError } from '@patchplane/domain/errors'
import {
  EvidenceArtifactKind,
  type EvidenceArtifact,
} from '@patchplane/domain/evidence-artifact'
import type { SandboxExecution } from '@patchplane/domain/sandbox-execution'
import { SandboxPolicy } from '@patchplane/domain/sandbox-policy'
import {
  VerificationPlatform,
  VerificationRequirementKind,
  type VerificationExecutionGroup,
  type VerificationRequirement,
  type VerificationResult,
} from '@patchplane/domain/verification'
import {
  EpochMillis,
  GitCommitSha,
  Sha256Digest,
} from '@patchplane/domain/refinements'
import type { WorkflowStart } from '@patchplane/domain/workflow-start'
import { PrepareRepositoryClone } from '../repository/prepare-repository-clone'
import {
  SandboxService,
  type SandboxCommandResult,
} from '../services/sandbox-service'
import { StorageService } from '../services/storage-service'
import { CaptureEvidenceArtifact } from './capture-evidence-artifact'
import { CaptureSandboxResultArtifacts } from './capture-sandbox-result-artifacts'
import type { IncomingPullRequestDispatch } from './freeze-incoming-pull-request-candidate'
import {
  isPersistedVerificationPlanV1,
  type PersistedVerificationPlanV1,
} from './persist-sandbox-verification-evidence'
import { ProposeMergeDecision } from './propose-merge-decision'

const commandLogMaxBytes = 1024 * 1024
const inlineLogPreviewBytes = 16 * 1024
const defaultRequirementTimeoutSeconds = 900

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  )
}

function boundedUtf8(value: string) {
  const encoded = new TextEncoder().encode(value)
  if (encoded.byteLength <= commandLogMaxBytes) {
    return { body: value, status: 'captured' as const }
  }
  return {
    body: `${new TextDecoder().decode(encoded.slice(0, commandLogMaxBytes))}\n\n…truncated by PatchPlane…`,
    status: 'truncated' as const,
  }
}

const TrustedProviderEnvelope = Schema.Struct({
  provider: Schema.NonEmptyString,
  sandboxId: Schema.NonEmptyString,
  sessionId: Schema.optional(Schema.NonEmptyString),
  commandId: Schema.optional(Schema.NonEmptyString),
  command: Schema.NonEmptyString,
  exitCode: Schema.optional(Schema.Int),
  stdout: Schema.String,
  stderr: Schema.optional(Schema.String),
  policy: Schema.optional(SandboxPolicy),
  evidenceArtifacts: Schema.optional(
    Schema.Array(
      Schema.Struct({
        kind: EvidenceArtifactKind,
        label: Schema.optional(Schema.String),
        contentType: Schema.NonEmptyString,
        body: Schema.Unknown,
        retentionPolicy: Schema.optional(Schema.NonEmptyString),
      }),
    ),
  ),
  verificationResults: Schema.optional(
    Schema.Array(
      Schema.Struct({
        requirementKey: Schema.optional(Schema.NonEmptyString),
        kind: VerificationRequirementKind,
        command: Schema.NonEmptyString,
        status: Schema.Literals(['succeeded', 'failed']),
        exitCode: Schema.optional(Schema.Int),
        message: Schema.optional(Schema.String),
        provider: Schema.optional(Schema.NonEmptyString),
        platform: Schema.optional(VerificationPlatform),
        architecture: Schema.optional(Schema.NonEmptyString),
        candidateDigestBefore: Schema.optional(Sha256Digest),
        candidateDigestAfter: Schema.optional(Sha256Digest),
        startedAt: Schema.optional(EpochMillis),
        completedAt: Schema.optional(EpochMillis),
      }),
    ),
  ),
  baseSha: Schema.optional(GitCommitSha),
  candidateStateDigest: Schema.optional(Sha256Digest),
  initialCandidateStateDigest: Schema.optional(Sha256Digest),
  startedAt: EpochMillis,
  completedAt: EpochMillis,
  cleanupStatus: Schema.optional(
    Schema.Literals(['deleted', 'failed', 'retained', 'not-started']),
  ),
})
const decodeTrustedProviderEnvelope = Schema.decodeUnknownOption(
  TrustedProviderEnvelope,
)

function artifactBodyByteLength(body: unknown): number | undefined {
  if (typeof body === 'string') return new TextEncoder().encode(body).byteLength
  if (body instanceof Uint8Array) return body.byteLength
  return undefined
}

function isTrustedProviderEnvelopeBounded(input: {
  readonly expectedCommand: string
  readonly result: SandboxCommandResult
}) {
  const decoded = decodeTrustedProviderEnvelope(input.result)
  if (Option.isNone(decoded)) return false
  const result = decoded.value
  const outputBytes =
    new TextEncoder().encode(result.stdout).byteLength +
    new TextEncoder().encode(result.stderr ?? '').byteLength
  return (
    result.command === input.expectedCommand &&
    result.provider.length > 0 &&
    result.provider.length <= 128 &&
    result.sandboxId.length > 0 &&
    result.sandboxId.length <= 256 &&
    Number.isSafeInteger(result.startedAt) &&
    Number.isSafeInteger(result.completedAt) &&
    result.startedAt >= 0 &&
    result.completedAt >= result.startedAt &&
    result.completedAt <= Date.now() + 60_000 &&
    outputBytes <= commandLogMaxBytes * 2 &&
    (result.verificationResults?.length ?? 0) === 1 &&
    (result.evidenceArtifacts?.length ?? 0) <= 14 &&
    (result.verificationResults ?? []).every(
      (verification) =>
        (verification.requirementKey?.length ?? 0) <= 256 &&
        verification.command.length <= 16_384 &&
        (verification.message?.length ?? 0) <= 16_384 &&
        (verification.provider?.length ?? 0) <= 128 &&
        (verification.architecture?.length ?? 0) <= 128 &&
        (verification.completedAt === undefined ||
          verification.startedAt === undefined ||
          verification.completedAt >= verification.startedAt),
    ) &&
    (result.evidenceArtifacts ?? []).every((artifact) => {
      const size = artifactBodyByteLength(artifact.body)
      return (
        artifact.contentType.length > 0 &&
        artifact.contentType.length <= 256 &&
        (artifact.label?.length ?? 0) <= 512 &&
        (artifact.retentionPolicy?.length ?? 0) <= 128 &&
        size !== undefined &&
        size <= 5_000_000
      )
    })
  )
}

function preview(value: string) {
  return value.length <= inlineLogPreviewBytes
    ? value
    : `${value.slice(0, inlineLogPreviewBytes)}\n\n…truncated; full bounded output stored as evidence artifact…`
}

function sameRequirement(
  planned: PersistedVerificationPlanV1['plan']['requirements'][number],
  persisted: VerificationRequirement,
) {
  return (
    persisted.verificationPlanId !== undefined &&
    persisted.key === planned.key &&
    persisted.label === planned.label &&
    persisted.kind === planned.kind &&
    persisted.required === planned.required &&
    persisted.command === planned.command &&
    persisted.platform === planned.platform &&
    persisted.architecture === planned.architecture &&
    persisted.timeoutSeconds === planned.timeoutSeconds &&
    JSON.stringify(persisted.requiredArtifactKinds) ===
      JSON.stringify(planned.requiredArtifactKinds)
  )
}

export interface IncomingVerificationPlanExecution {
  readonly sandboxExecutions: ReadonlyArray<SandboxExecution>
  readonly verificationResults: ReadonlyArray<VerificationResult>
}

/** Executes every trusted requirement in its own fresh, non-shared Daytona sandbox. */
export const RunIncomingVerificationPlan = Effect.fn(
  '@patchplane/core/workflows/RunIncomingVerificationPlan',
)(function* (input: {
  readonly workflowStart: WorkflowStart
  readonly incomingDispatch: IncomingPullRequestDispatch
  readonly verificationPlan: PersistedVerificationPlanV1
}) {
  const storage = yield* StorageService
  const sandbox = yield* SandboxService
  const crypto = yield* Crypto.Crypto
  const workflowRun = input.workflowStart.workflowRun
  const candidate = input.incomingDispatch.candidatePatchSet
  const planCapability = input.verificationPlan
  const claimGroup = storage.claimVerificationExecutionGroup
  const startGroup = storage.startVerificationExecutionGroup

  if (
    workflowRun.candidateIdentityVersion !== 'incoming-pr-v1' ||
    !isPersistedVerificationPlanV1(planCapability) ||
    planCapability.plan.workflowRunId !== workflowRun.id ||
    planCapability.requirements.length !==
      planCapability.plan.requirements.length ||
    planCapability.plan.requirements.some(
      (planned) =>
        !planCapability.requirements.some((persisted) =>
          sameRequirement(planned, persisted),
        ),
    ) ||
    candidate.subject?.kind !== 'incoming-pull-request' ||
    candidate.status !== 'captured' ||
    candidate.candidateDigest === undefined ||
    candidate.baseSha !== workflowRun.sourceBaseSha ||
    candidate.headSha !== workflowRun.sourceCommitSha
  ) {
    return yield* new SandboxError({
      operation: 'runIncomingVerificationPlan.validate',
      message:
        'Incoming verification requires an exact frozen candidate, persisted plan, and execution-group storage',
      cause: undefined,
    })
  }

  if (
    !(yield* storage.validateIncomingDispatch({
      workflowRunId: workflowRun.id,
      candidatePatchSetId: candidate.id,
      dispatchToken: input.incomingDispatch.dispatchToken,
      traceId: workflowRun.traceId,
      operation: 'runIncomingVerificationPlan.validateDispatch',
    }))
  ) {
    return yield* new SandboxError({
      operation: 'runIncomingVerificationPlan.validateDispatch',
      message: 'Incoming candidate dispatch lease is not active',
      cause: undefined,
    })
  }

  const planStarted = yield* storage.startIncomingVerificationPlan({
    workflowRunId: workflowRun.id,
    verificationPlanId: planCapability.plan.id,
    candidatePatchSetId: candidate.id,
    incomingDispatchToken: input.incomingDispatch.dispatchToken,
    traceId: workflowRun.traceId,
    operation: 'runIncomingVerificationPlan.startPlan',
  })
  if (!planStarted) {
    return yield* new SandboxError({
      operation: 'runIncomingVerificationPlan.startPlan',
      message: 'Incoming verification plan start was fenced',
      cause: undefined,
    })
  }

  const claimedGroups = new Map<
    VerificationRequirement['id'],
    {
      readonly group: VerificationExecutionGroup
      readonly claimToken: string
      readonly claimedAt: number
      readonly commandDigest?: VerificationResult['commandDigest'] | undefined
      readonly timeoutSeconds: number
    }
  >()
  for (const requirement of planCapability.requirements) {
    const command = requirement.command
    const commandDigest =
      command === undefined
        ? undefined
        : `sha256:${Encoding.encodeHex(
            yield* crypto.digest('SHA-256', new TextEncoder().encode(command)),
          )}`
    const claimToken = hex(yield* crypto.randomBytes(16))
    const claimedAt = yield* Clock.currentTimeMillis
    const group = yield* claimGroup({
      workflowRunId: workflowRun.id,
      verificationPlanId: planCapability.plan.id,
      requirementId: requirement.id,
      candidatePatchSetId: candidate.id,
      stableKey: `${planCapability.plan.id}:${requirement.id}:${candidate.id}`,
      claimToken,
      incomingDispatchToken: input.incomingDispatch.dispatchToken,
      provider: 'daytona',
      platform: requirement.platform ?? 'linux',
      architecture: requirement.architecture ?? 'x86_64',
      ...(commandDigest === undefined ? {} : { commandDigest }),
      timeoutSeconds:
        requirement.timeoutSeconds ?? defaultRequirementTimeoutSeconds,
      claimedAt,
      traceId: workflowRun.traceId,
      operation: 'runIncomingVerificationPlan.claimGroup',
    })
    if (group !== undefined) {
      claimedGroups.set(requirement.id, {
        group,
        claimToken,
        claimedAt,
        ...(commandDigest === undefined ? {} : { commandDigest }),
        timeoutSeconds:
          requirement.timeoutSeconds ?? defaultRequirementTimeoutSeconds,
      })
    }
  }

  const clone = yield* PrepareRepositoryClone(input.workflowStart)
  if (clone === undefined || clone.commitId !== workflowRun.sourceCommitSha) {
    return yield* new SandboxError({
      operation: 'runIncomingVerificationPlan.prepareRepository',
      message:
        'Incoming verification clone is not pinned to the exact head SHA',
      cause: undefined,
    })
  }

  for (const requirement of planCapability.requirements) {
    const claimed = claimedGroups.get(requirement.id)
    if (claimed === undefined) continue
    const { group, claimToken, claimedAt, commandDigest, timeoutSeconds } =
      claimed
    const platform = requirement.platform ?? 'linux'
    const architecture = requirement.architecture ?? 'x86_64'
    const command = requirement.command

    yield* Effect.gen(function* () {
      if (platform !== 'linux' || command === undefined) {
        const completedAt = yield* Clock.currentTimeMillis
        yield* storage.recordVerificationResult({
          workflowRunId: workflowRun.id,
          verificationPlanId: planCapability.plan.id,
          executionGroupId: group.id,
          executionGroupClaimToken: claimToken,
          requirementId: requirement.id,
          candidatePatchSetId: candidate.id,
          provider: 'daytona',
          ...(command === undefined ? {} : { command }),
          ...(commandDigest === undefined ? {} : { commandDigest }),
          platform,
          architecture,
          status: 'blocked',
          summary:
            command === undefined
              ? 'Trusted requirement has no executable command envelope.'
              : `Required ${platform} verification is unavailable in the Daytona Linux executor.`,
          artifactIds: [],
          producedArtifactKinds: [],
          stdoutCaptureStatus: 'failed',
          stderrCaptureStatus: 'failed',
          cleanupStatus: 'not-started',
          candidateDigestBefore: candidate.candidateDigest,
          candidateDigestAfter: candidate.candidateDigest,
          startedAt: claimedAt,
          completedAt,
          idempotencyKey: `${group.id}:result`,
          traceId: workflowRun.traceId,
          operation: 'runIncomingVerificationPlan.recordBlockedResult',
        })
        return
      }

      const sandboxResult = yield* sandbox
        .runRepositoryCommand({
          ...clone,
          candidateBaseSha: candidate.baseSha!,
          command,
          timeoutSeconds,
          verificationInvocation: {
            requirementKey: requirement.key,
            kind: requirement.kind,
            command,
            platform,
            architecture,
            timeoutSeconds,
            requiredArtifactKinds: requirement.requiredArtifactKinds,
          },
          forceDeleteAfterUse: true,
          traceId: workflowRun.traceId,
          onSandboxStarted: (sandboxId) =>
            startGroup({
              workflowRunId: workflowRun.id,
              executionGroupId: group.id,
              claimToken,
              sandboxId,
              traceId: workflowRun.traceId,
              operation: 'runIncomingVerificationPlan.startGroup',
            }).pipe(
              Effect.filterOrFail(
                (started) => started,
                () =>
                  new SandboxError({
                    operation: 'runIncomingVerificationPlan.startGroup',
                    message: 'Verification execution group start was fenced',
                    cause: group.id,
                  }),
              ),
              Effect.asVoid,
            ),
        })
        .pipe(
          Effect.onInterrupt(() =>
            storage
              .recordVerificationResult({
                workflowRunId: workflowRun.id,
                verificationPlanId: planCapability.plan.id,
                executionGroupId: group.id,
                executionGroupClaimToken: claimToken,
                requirementId: requirement.id,
                candidatePatchSetId: candidate.id,
                provider: 'daytona',
                command,
                commandDigest,
                platform,
                architecture,
                status: 'cancelled',
                summary: 'Trusted command execution was interrupted.',
                artifactIds: [],
                producedArtifactKinds: [],
                stdoutCaptureStatus: 'failed',
                stderrCaptureStatus: 'failed',
                cleanupStatus: 'failed',
                candidateDigestBefore: candidate.candidateDigest,
                startedAt: claimedAt,
                completedAt: Date.now(),
                idempotencyKey: `${group.id}:result`,
                traceId: workflowRun.traceId,
                operation: 'runIncomingVerificationPlan.cancelGroup',
              })
              .pipe(Effect.asVoid),
          ),
          Effect.match({
            onFailure: (error) => ({ ok: false as const, error }),
            onSuccess: (value) => ({ ok: true as const, value }),
          }),
        )

      if (!sandboxResult.ok) {
        const completedAt = yield* Clock.currentTimeMillis
        yield* storage.recordVerificationResult({
          workflowRunId: workflowRun.id,
          verificationPlanId: planCapability.plan.id,
          executionGroupId: group.id,
          executionGroupClaimToken: claimToken,
          requirementId: requirement.id,
          candidatePatchSetId: candidate.id,
          provider: 'daytona',
          command,
          commandDigest,
          platform,
          architecture,
          status: 'error',
          summary: 'Daytona could not complete the trusted command envelope.',
          artifactIds: [],
          producedArtifactKinds: [],
          stdoutCaptureStatus: 'failed',
          stderrCaptureStatus: 'failed',
          cleanupStatus: 'failed',
          candidateDigestBefore: candidate.candidateDigest,
          startedAt: claimedAt,
          completedAt,
          idempotencyKey: `${group.id}:result`,
          traceId: workflowRun.traceId,
          operation: 'runIncomingVerificationPlan.recordProviderError',
        })
        return
      }

      const result = sandboxResult.value
      if (
        !isTrustedProviderEnvelopeBounded({ expectedCommand: command, result })
      ) {
        yield* storage.recordVerificationResult({
          workflowRunId: workflowRun.id,
          verificationPlanId: planCapability.plan.id,
          executionGroupId: group.id,
          executionGroupClaimToken: claimToken,
          requirementId: requirement.id,
          candidatePatchSetId: candidate.id,
          provider: 'daytona',
          command,
          commandDigest,
          platform,
          architecture,
          status: 'error',
          summary: 'Daytona returned an invalid or oversized command envelope.',
          artifactIds: [],
          producedArtifactKinds: [],
          stdoutCaptureStatus: 'failed',
          stderrCaptureStatus: 'failed',
          cleanupStatus: result.cleanupStatus ?? 'failed',
          candidateDigestBefore: candidate.candidateDigest,
          startedAt: claimedAt,
          completedAt: yield* Clock.currentTimeMillis,
          idempotencyKey: `${group.id}:result`,
          traceId: workflowRun.traceId,
          operation: 'runIncomingVerificationPlan.recordInvalidEnvelope',
        })
        return
      }
      const sandboxExecution = yield* storage.recordSandboxExecution({
        workflowRunId: workflowRun.id,
        executionGroupId: group.id,
        executionGroupClaimToken: claimToken,
        idempotencyKey: `${group.id}:sandbox-execution`,
        provider: result.provider,
        sandboxId: result.sandboxId,
        command: result.command,
        status: result.exitCode === 0 ? 'succeeded' : 'failed',
        ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
        stdout: preview(result.stdout),
        ...(result.stderr === undefined
          ? {}
          : { stderr: preview(result.stderr) }),
        ...(result.policy === undefined ? {} : { policy: result.policy }),
        startedAt: result.startedAt,
        completedAt: result.completedAt,
        traceId: workflowRun.traceId,
        operation: 'runIncomingVerificationPlan.recordSandboxExecution',
      })
      const producer = `sandbox:${requirement.kind}:${result.provider}:${result.sandboxId}:${result.startedAt}`
      const captureLog = (kind: 'stdout' | 'stderr', value: string) => {
        const bounded = boundedUtf8(value)
        return CaptureEvidenceArtifact({
          workflowRunId: workflowRun.id,
          traceId: workflowRun.traceId,
          producer,
          subjectDigest: candidate.candidateDigest!,
          kind,
          label: `${requirement.label} ${kind}`,
          contentType: 'text/plain; charset=utf-8',
          body: bounded.body,
          retentionPolicy: 'alpha-14d',
          idempotencyKey: `${group.id}:${kind}`,
        }).pipe(
          Effect.map((artifact) => ({ artifact, status: bounded.status })),
          Effect.option,
        )
      }
      const stdoutCapture = yield* captureLog('stdout', result.stdout)
      const stderrCapture = yield* captureLog('stderr', result.stderr ?? '')
      const stdout = Option.getOrUndefined(stdoutCapture)
      const stderr = Option.getOrUndefined(stderrCapture)
      const evidenceArtifactCapture = yield* CaptureSandboxResultArtifacts({
        workflowRunId: workflowRun.id,
        traceId: workflowRun.traceId,
        result,
        subjectDigest: candidate.candidateDigest,
        verificationRequirementKey: requirement.key,
        verificationRequirementKind: requirement.kind,
        ...(result.initialCandidateStateDigest === undefined
          ? {}
          : {
              initialCandidateStateDigest: result.initialCandidateStateDigest,
            }),
      }).pipe(Effect.option)
      const evidenceArtifacts =
        Option.getOrUndefined(evidenceArtifactCapture) ?? []
      const providerArtifactsCaptured = Option.isSome(evidenceArtifactCapture)
      const transient = result.verificationResults?.find(
        (verification) => verification.requirementKey === requirement.key,
      )
      const artifacts = [
        ...evidenceArtifacts,
        ...(stdout === undefined ? [] : [stdout.artifact]),
        ...(stderr === undefined ? [] : [stderr.artifact]),
      ] satisfies ReadonlyArray<EvidenceArtifact>
      const requiredArtifactsPresent = requirement.requiredArtifactKinds.every(
        (kind) => artifacts.some((artifact) => artifact.kind === kind),
      )
      const candidateUnchanged =
        transient?.candidateDigestBefore !== undefined &&
        transient.candidateDigestBefore === transient.candidateDigestAfter &&
        transient.candidateDigestBefore ===
          result.initialCandidateStateDigest &&
        transient.candidateDigestAfter === result.candidateStateDigest &&
        result.baseSha === candidate.headSha
      const logsCaptured =
        stdout?.status === 'captured' && stderr?.status === 'captured'
      const status: VerificationResult['status'] = !candidateUnchanged
        ? 'invalidated'
        : transient === undefined ||
            transient.command !== command ||
            transient.platform !== platform ||
            transient.architecture !== architecture ||
            transient.exitCode === undefined ||
            result.cleanupStatus !== 'deleted' ||
            !providerArtifactsCaptured ||
            !logsCaptured ||
            !requiredArtifactsPresent
          ? 'error'
          : transient.exitCode === 0 && transient.status === 'succeeded'
            ? 'passed'
            : transient.exitCode !== 0
              ? 'failed'
              : 'error'
      yield* storage.recordVerificationResult({
        workflowRunId: workflowRun.id,
        verificationPlanId: planCapability.plan.id,
        executionGroupId: group.id,
        executionGroupClaimToken: claimToken,
        requirementId: requirement.id,
        candidatePatchSetId: candidate.id,
        sandboxExecutionId: sandboxExecution.id,
        provider: result.provider,
        command,
        commandDigest,
        platform,
        architecture,
        status,
        ...(transient?.exitCode === undefined
          ? {}
          : { exitCode: transient.exitCode }),
        ...(transient?.message === undefined
          ? {}
          : { summary: transient.message }),
        artifactIds: artifacts.map((artifact) => artifact.id),
        producedArtifactKinds: artifacts.map((artifact) => artifact.kind),
        ...(stdout === undefined
          ? {}
          : { stdoutArtifactId: stdout.artifact.id }),
        ...(stderr === undefined
          ? {}
          : { stderrArtifactId: stderr.artifact.id }),
        stdoutCaptureStatus: stdout?.status ?? 'failed',
        stderrCaptureStatus: stderr?.status ?? 'failed',
        cleanupStatus: result.cleanupStatus ?? 'failed',
        ...(candidateUnchanged
          ? {
              candidateDigestBefore: candidate.candidateDigest,
              candidateDigestAfter: candidate.candidateDigest,
            }
          : {
              ...(transient?.candidateDigestBefore === undefined
                ? {}
                : { candidateDigestBefore: transient.candidateDigestBefore }),
              ...(transient?.candidateDigestAfter === undefined
                ? {}
                : { candidateDigestAfter: transient.candidateDigestAfter }),
            }),
        startedAt: transient?.startedAt ?? result.startedAt,
        completedAt: transient?.completedAt ?? result.completedAt,
        idempotencyKey: `${group.id}:result`,
        traceId: workflowRun.traceId,
        operation: 'runIncomingVerificationPlan.recordResult',
      })
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning(
          'Verification execution group persistence failed; recovery will terminalize the claimed group',
          {
            workflowRunId: workflowRun.id,
            executionGroupId: group.id,
            requirementKey: requirement.key,
            operation: error.operation,
          },
        ),
      ),
    )
  }

  const durableState = yield* storage.getVerificationExecutionState({
    workflowRunId: workflowRun.id,
    verificationPlanId: planCapability.plan.id,
    candidatePatchSetId: candidate.id,
    traceId: workflowRun.traceId,
    operation: 'runIncomingVerificationPlan.getExecutionState',
  })
  const expectedStableKeys = new Set(
    planCapability.requirements.map(
      (requirement) =>
        `${planCapability.plan.id}:${requirement.id}:${candidate.id}`,
    ),
  )
  const terminalStatuses = new Set([
    'completed',
    'failed',
    'blocked',
    'cancelled',
  ])
  const complete =
    durableState.groups.length === expectedStableKeys.size &&
    durableState.groups.every(
      (group) =>
        expectedStableKeys.has(group.stableKey) &&
        terminalStatuses.has(group.status) &&
        durableState.results.filter(
          (result) => result.executionGroupId === group.id,
        ).length === 1,
    )

  if (complete) {
    const latestExecution = durableState.sandboxExecutions.reduce<
      SandboxExecution | undefined
    >(
      (latest, execution) =>
        latest === undefined || execution.completedAt > latest.completedAt
          ? execution
          : latest,
      undefined,
    )
    yield* ProposeMergeDecision({
      workflowRunId: workflowRun.id,
      ...(latestExecution === undefined
        ? {}
        : { sandboxExecution: latestExecution }),
      candidatePatchSet: candidate,
      evidenceArtifacts: [],
      verificationRequirements: planCapability.requirements,
      verificationResults: durableState.results,
      traceId: workflowRun.traceId,
      operation: 'runIncomingVerificationPlan.proposeMergeDecision',
    })
  }

  return {
    sandboxExecutions: durableState.sandboxExecutions,
    verificationResults: durableState.results,
  }
})
