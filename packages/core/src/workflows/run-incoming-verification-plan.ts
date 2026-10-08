import { Clock, Crypto, Effect } from 'effect'
import * as Hex from 'effect/encoding/Hex'
import { SandboxError } from '@patchplane/domain/errors'
import type { SandboxExecution } from '@patchplane/domain/sandbox-execution'
import type { VerificationRequirement } from '@patchplane/domain/verification'
import type { WorkflowStart } from '@patchplane/domain/workflow-start'
import { PrepareRepositoryClone } from '../repository/prepare-repository-clone'
import { StorageService } from '../services/storage-service'
import type { IncomingPullRequestDispatch } from './freeze-incoming-pull-request-candidate'
import {
  isPersistedVerificationPlanV1,
  type PersistedVerificationPlanV1,
} from './persist-sandbox-verification-evidence'
import { ProposeMergeDecision } from './propose-merge-decision'
import {
  ExecuteIncomingVerificationRequirements,
  type ClaimedVerificationExecutionGroup,
} from './execute-incoming-verification-requirements'
import {
  defaultRequirementTimeoutSeconds,
  hex,
  hostedGroupLifecycleAllowanceSeconds,
  sameRequirement,
} from './incoming-verification-plan-validation'

export {
  invalidProviderEnvelopeCleanupStatus,
  isTrustedProviderEnvelopeBounded,
  verificationCandidateIntegrityFailureStatus,
  verificationCandidateStateMatches,
  verificationProtectedSourcePolicyMatches,
} from './incoming-verification-plan-validation'
export type { IncomingVerificationPlanExecution } from './incoming-verification-plan-validation'

export const RunIncomingVerificationPlan = Effect.fn(
  '@patchplane/core/workflows/RunIncomingVerificationPlan',
)(function* (input: {
  readonly workflowStart: WorkflowStart
  readonly incomingDispatch: IncomingPullRequestDispatch
  readonly verificationPlan: PersistedVerificationPlanV1
  readonly maxAggregateExecutionSeconds?: number | undefined
}) {
  const storage = yield* StorageService
  const crypto = yield* Crypto.Crypto
  const workflowRun = input.workflowStart.workflowRun
  const candidate = input.incomingDispatch.candidatePatchSet
  const planCapability = input.verificationPlan
  const claimGroup = storage.claimVerificationExecutionGroup
  const recordCommand = storage.recordVerificationExecutionCommand

  if (
    workflowRun.candidateIdentityVersion !== 'incoming-pr-v1' ||
    recordCommand === undefined ||
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
    ClaimedVerificationExecutionGroup
  >()
  for (const requirement of planCapability.requirements) {
    const command = requirement.command
    const commandDigest =
      command === undefined
        ? undefined
        : `sha256:${Hex.encode(
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

  const aggregateExecutionSeconds = Array.from(claimedGroups.values()).reduce(
    (total, claimed) =>
      total + claimed.timeoutSeconds + hostedGroupLifecycleAllowanceSeconds,
    0,
  )
  const capacityBlocked =
    input.maxAggregateExecutionSeconds !== undefined &&
    (claimedGroups.size !== 1 ||
      aggregateExecutionSeconds > input.maxAggregateExecutionSeconds)
  const clone = capacityBlocked
    ? undefined
    : yield* PrepareRepositoryClone(input.workflowStart)
  if (
    !capacityBlocked &&
    (clone === undefined || clone.commitId !== workflowRun.sourceCommitSha)
  ) {
    return yield* new SandboxError({
      operation: 'runIncomingVerificationPlan.prepareRepository',
      message:
        'Incoming verification clone is not pinned to the exact head SHA',
      cause: undefined,
    })
  }

  yield* ExecuteIncomingVerificationRequirements({
    workflowRun,
    candidate,
    planCapability,
    claimedGroups,
    capacityBlocked,
    clone,
  })

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
    complete,
  }
})
