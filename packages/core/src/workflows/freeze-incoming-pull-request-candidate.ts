import { Clock, Crypto, Effect, Option } from 'effect'
import type { CandidatePatchSet } from '@patchplane/domain/decision-review'
import { WorkflowStateError } from '@patchplane/domain/errors'
import { decodeIncomingPullRequestCandidateSubject } from '@patchplane/domain/candidate-subject'
import type { WorkflowStart } from '@patchplane/domain/workflow-start'
import { ArtifactsService } from '../services/artifacts-service'
import { SourceControlService } from '../services/source-control-service'
import { StorageService } from '../services/storage-service'
import { CaptureEvidenceArtifact } from './capture-evidence-artifact'
import {
  withAttemptClaimTransition,
  withCandidateFreezeTransition,
} from './sandbox-workflow-telemetry'

export const incomingPullRequestComparisonMaxBytes = 10 * 1024 * 1024

declare const incomingDispatchBrand: unique symbol
export interface IncomingPullRequestDispatch {
  readonly candidatePatchSet: CandidatePatchSet
  readonly dispatchToken: string
  readonly [incomingDispatchBrand]: true
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  )
}

function isPermanentComparisonFailure(error: {
  readonly operation: string
  readonly cause?: unknown
}) {
  if (
    [
      'fetchImmutableComparison.validateContentType',
      'fetchImmutableComparison.size',
      'fetchImmutableComparison.decode',
      'fetchImmutableComparison.binary',
      'fetchImmutableComparison.truncated',
    ].includes(error.operation)
  ) {
    return true
  }
  if (
    error.operation === 'fetchImmutableComparison.github' &&
    typeof error.cause === 'object' &&
    error.cause !== null &&
    'status' in error.cause
  ) {
    return error.cause.status === 404 || error.cause.status === 406
  }
  return false
}

function candidateMatchesWorkflow(
  workflowStart: WorkflowStart,
  candidate: CandidatePatchSet,
) {
  const { promptRequest, workflowRun } = workflowStart
  const externalRef = promptRequest.externalRef
  const subject = candidate.subject
  return (
    workflowRun.candidateIdentityVersion === 'incoming-pr-v1' &&
    workflowRun.sourceBaseSha !== undefined &&
    workflowRun.sourceCommitSha !== undefined &&
    externalRef?.provider === 'github' &&
    externalRef.repositoryProvider === 'github' &&
    externalRef.repositoryExternalId !== undefined &&
    externalRef.pullRequestExternalId !== undefined &&
    externalRef.pullRequestNumber !== undefined &&
    externalRef.pullRequestBaseSha === workflowRun.sourceBaseSha &&
    externalRef.pullRequestHeadSha === workflowRun.sourceCommitSha &&
    candidate.workflowRunId === workflowRun.id &&
    candidate.status === 'captured' &&
    candidate.candidateDigest !== undefined &&
    candidate.diffArtifactId !== undefined &&
    candidate.sandboxExecutionId === undefined &&
    candidate.baseSha === workflowRun.sourceBaseSha &&
    candidate.headSha === workflowRun.sourceCommitSha &&
    subject?.kind === 'incoming-pull-request' &&
    subject.repositoryProvider === 'github' &&
    subject.repositoryExternalId === externalRef.repositoryExternalId &&
    subject.repositoryOwner === externalRef.repositoryOwner &&
    subject.repositoryName === externalRef.repositoryName &&
    subject.repositoryFullName === externalRef.repositoryFullName &&
    subject.pullRequestExternalId === externalRef.pullRequestExternalId &&
    subject.pullRequestNumber === externalRef.pullRequestNumber &&
    subject.baseSha === workflowRun.sourceBaseSha &&
    subject.headSha === workflowRun.sourceCommitSha &&
    subject.sourceEventProvider === externalRef.provider &&
    subject.sourceEventDeliveryId === externalRef.deliveryId &&
    subject.sourceEventKind === externalRef.eventKind
  )
}

export const ClaimIncomingPullRequestDispatch = Effect.fn(
  '@patchplane/core/workflows/ClaimIncomingPullRequestDispatch',
)(function* (input: {
  readonly workflowStart: WorkflowStart
  readonly candidatePatchSet: CandidatePatchSet
}) {
  if (!candidateMatchesWorkflow(input.workflowStart, input.candidatePatchSet)) {
    return yield* new WorkflowStateError({
      message:
        'Incoming PR dispatch requires the exact frozen workflow candidate',
    })
  }
  const storage = yield* StorageService
  const durableCandidate = yield* storage.getCandidatePatchSetForWorkflow({
    workflowRunId: input.workflowStart.workflowRun.id,
    traceId: input.workflowStart.workflowRun.traceId,
    operation: 'claimIncomingPullRequestDispatch.getCandidate',
  })
  if (
    Option.isNone(durableCandidate) ||
    durableCandidate.value.id !== input.candidatePatchSet.id ||
    durableCandidate.value.candidateDigest !==
      input.candidatePatchSet.candidateDigest ||
    durableCandidate.value.diffArtifactId !==
      input.candidatePatchSet.diffArtifactId ||
    !candidateMatchesWorkflow(input.workflowStart, durableCandidate.value)
  ) {
    return yield* new WorkflowStateError({
      message: 'Incoming PR dispatch candidate is not durably persisted',
    })
  }
  const workflowRun = input.workflowStart.workflowRun
  const artifactId = durableCandidate.value.diffArtifactId!
  const evidence = yield* storage.getEvidenceArtifact({
    artifactId,
    workflowRunId: workflowRun.id,
    traceId: workflowRun.traceId,
    operation: 'claimIncomingPullRequestDispatch.getEvidenceArtifact',
  })
  if (Option.isNone(evidence)) {
    return yield* new WorkflowStateError({
      message: 'Incoming PR dispatch candidate artifact is not durably persisted',
    })
  }
  const artifact = evidence.value
  const artifacts = yield* ArtifactsService
  const object = yield* artifacts
    .getArtifactMetadata({
      storageKey: artifact.storageKey,
      traceId: workflowRun.traceId,
      workflowRunId: workflowRun.id,
      operation: 'claimIncomingPullRequestDispatch.getArtifactMetadata',
    })
    .pipe(Effect.option)
  const expectedDigest = durableCandidate.value.candidateDigest!
  if (
    artifact.id !== artifactId ||
    artifact.workflowRunId !== workflowRun.id ||
    artifact.kind !== 'diff' ||
    artifact.storageProvider !== 'cloudflare-r2' ||
    artifact.subjectDigest !== expectedDigest ||
    `sha256:${artifact.sha256}` !== expectedDigest ||
    Option.isNone(object) ||
    object.value.storageProvider !== artifact.storageProvider ||
    object.value.storageKey !== artifact.storageKey ||
    object.value.contentType !== artifact.contentType ||
    object.value.sizeBytes !== artifact.sizeBytes ||
    object.value.sha256 !== artifact.sha256
  ) {
    return yield* new WorkflowStateError({
      message:
        'Incoming PR dispatch candidate artifact is missing or inconsistent',
    })
  }
  const crypto = yield* Crypto.Crypto
  const dispatchToken = hex(yield* crypto.randomBytes(16))
  const claimed = yield* withAttemptClaimTransition(
    {
      traceId: workflowRun.traceId,
      workflowRunId: workflowRun.id,
      operation: 'claimIncomingPullRequestDispatch.claimExecution',
    },
    storage.claimIncomingDispatch({
      workflowRunId: workflowRun.id,
      candidatePatchSetId: durableCandidate.value.id,
      dispatchToken,
      traceId: workflowRun.traceId,
      operation: 'claimIncomingPullRequestDispatch.claimExecution',
    }),
  )
  if (!claimed) return undefined
  return {
    candidatePatchSet: durableCandidate.value,
    dispatchToken,
  } as IncomingPullRequestDispatch
})

export const FreezeIncomingPullRequestCandidate = Effect.fn(
  '@patchplane/core/workflows/FreezeIncomingPullRequestCandidate',
)(function* (input: { readonly workflowStart: WorkflowStart }) {
  const { promptRequest, workflowRun } = input.workflowStart
  const externalRef = promptRequest.externalRef
  if (
    workflowRun.candidateIdentityVersion !== 'incoming-pr-v1' ||
    workflowRun.sourceBaseSha === undefined ||
    workflowRun.sourceCommitSha === undefined ||
    externalRef?.provider !== 'github' ||
    externalRef.repositoryProvider !== 'github' ||
    externalRef.repositoryInstallationId === undefined ||
    externalRef.repositoryExternalId === undefined ||
    externalRef.repositoryOwner === undefined ||
    externalRef.repositoryName === undefined ||
    externalRef.repositoryFullName === undefined ||
    externalRef.pullRequestExternalId === undefined ||
    externalRef.pullRequestNumber === undefined ||
    externalRef.pullRequestBaseSha !== workflowRun.sourceBaseSha ||
    externalRef.pullRequestHeadSha !== workflowRun.sourceCommitSha
  ) {
    return yield* new WorkflowStateError({
      message:
        'Incoming pull request candidate freeze requires complete immutable workflow identity',
    })
  }

  const storage = yield* StorageService
  const existing = yield* storage.getCandidatePatchSetForWorkflow({
    workflowRunId: workflowRun.id,
    traceId: workflowRun.traceId,
    operation: 'freezeIncomingPullRequestCandidate.getExisting',
  })
  if (Option.isSome(existing)) {
    if (!candidateMatchesWorkflow(input.workflowStart, existing.value)) {
      return yield* new WorkflowStateError({
        message:
          'Persisted workflow candidate does not match immutable incoming PR identity',
      })
    }
    return existing.value
  }

  const crypto = yield* Crypto.Crypto
  const freezeLeaseToken = hex(yield* crypto.randomBytes(16))
  const freezeClaimed = yield* storage.claimCandidateFreeze({
    workflowRunId: workflowRun.id,
    leaseToken: freezeLeaseToken,
    traceId: workflowRun.traceId,
    operation: 'freezeIncomingPullRequestCandidate.claimFreeze',
  })
  if (!freezeClaimed) return undefined

  const transitionContext = {
    traceId: workflowRun.traceId,
    workflowRunId: workflowRun.id,
  } as const
  return yield* Effect.gen(function* () {
    const subject = yield* decodeIncomingPullRequestCandidateSubject({
      kind: 'incoming-pull-request',
      repositoryProvider: 'github',
      repositoryExternalId: externalRef.repositoryExternalId,
      repositoryOwner: externalRef.repositoryOwner,
      repositoryName: externalRef.repositoryName,
      repositoryFullName: externalRef.repositoryFullName,
      pullRequestExternalId: externalRef.pullRequestExternalId,
      pullRequestNumber: externalRef.pullRequestNumber,
      baseSha: workflowRun.sourceBaseSha,
      headSha: workflowRun.sourceCommitSha,
      sourceEventProvider: 'github',
      sourceEventDeliveryId: externalRef.deliveryId,
      sourceEventKind: externalRef.eventKind,
    }).pipe(
      Effect.mapError(
        () =>
          new WorkflowStateError({
            message: 'Incoming pull request candidate subject is invalid',
          }),
      ),
    )
    const sourceControl = yield* SourceControlService
    const comparison = yield* sourceControl.fetchImmutableComparison({
      provider: 'github',
      installationId: externalRef.repositoryInstallationId!,
      owner: externalRef.repositoryOwner!,
      name: externalRef.repositoryName!,
      baseSha: workflowRun.sourceBaseSha!,
      headSha: workflowRun.sourceCommitSha!,
      maxBytes: incomingPullRequestComparisonMaxBytes,
      timeoutMilliseconds: 30_000,
      traceId: workflowRun.traceId,
      workflowRunId: workflowRun.id,
      operation: 'freezeIncomingPullRequestCandidate.fetchComparison',
    })
    const digestBytes = yield* crypto.digest('SHA-256', comparison.bytes)
    const candidateDigest = `sha256:${hex(digestBytes)}`
    const producer = `source-control:github:compare:${externalRef.repositoryExternalId}:${workflowRun.sourceBaseSha}...${workflowRun.sourceCommitSha}`
    const diffArtifact = yield* CaptureEvidenceArtifact({
      workflowRunId: workflowRun.id,
      traceId: workflowRun.traceId,
      kind: 'diff',
      label: `Incoming PR #${externalRef.pullRequestNumber} immutable comparison`,
      producer,
      subjectDigest: candidateDigest,
      contentType: comparison.contentType,
      body: comparison.bytes,
      storageKeyHint: `incoming-pr-${externalRef.pullRequestNumber}-${workflowRun.sourceBaseSha}-${workflowRun.sourceCommitSha}.diff`,
      idempotencyKey: `${workflowRun.id}:incoming-pr:${workflowRun.sourceBaseSha}:${workflowRun.sourceCommitSha}:diff`,
      retentionPolicy: 'alpha-14d',
      operation: 'freezeIncomingPullRequestCandidate.captureDiff',
    })
    if (`sha256:${diffArtifact.sha256}` !== candidateDigest) {
      return yield* new WorkflowStateError({
        message:
          'Stored immutable comparison digest does not match the captured candidate',
      })
    }
    const createdAt = yield* Clock.currentTimeMillis
    return yield* withCandidateFreezeTransition(
      {
        ...transitionContext,
        operation: 'freezeIncomingPullRequestCandidate.recordCandidate',
      },
      storage.recordCandidatePatchSet({
        workflowRunId: workflowRun.id,
        subject,
        candidateFreezeLeaseToken: freezeLeaseToken,
        status: 'captured',
        candidateDigest,
        ...(externalRef.pullRequestBaseRef === undefined
          ? {}
          : { baseRef: externalRef.pullRequestBaseRef }),
        baseSha: workflowRun.sourceBaseSha,
        ...(externalRef.pullRequestHeadRef === undefined
          ? {}
          : { headRef: externalRef.pullRequestHeadRef }),
        headSha: workflowRun.sourceCommitSha,
        diffArtifactId: diffArtifact.id,
        summary: `Frozen exact incoming PR candidate ${workflowRun.sourceBaseSha}...${workflowRun.sourceCommitSha}.`,
        idempotencyKey: `${workflowRun.id}:incoming-pr:${workflowRun.sourceBaseSha}:${workflowRun.sourceCommitSha}`,
        createdAt,
        traceId: workflowRun.traceId,
        operation: 'freezeIncomingPullRequestCandidate.recordCandidate',
      }),
    )
  }).pipe(
    Effect.catchTags({
      SourceControlError: (error) =>
        isPermanentComparisonFailure(error)
          ? storage
              .failCandidateFreeze({
                workflowRunId: workflowRun.id,
                leaseToken: freezeLeaseToken,
                summary: `Incoming pull request candidate freeze failed closed: ${error.message}`,
                traceId: workflowRun.traceId,
                operation: 'freezeIncomingPullRequestCandidate.failPermanent',
              })
              .pipe(Effect.andThen(Effect.fail(error)))
          : Effect.fail(error),
      WorkflowStateError: (error) =>
        storage
          .failCandidateFreeze({
            workflowRunId: workflowRun.id,
            leaseToken: freezeLeaseToken,
            summary: `Incoming pull request candidate freeze failed closed: ${error.message}`,
            traceId: workflowRun.traceId,
            operation: 'freezeIncomingPullRequestCandidate.failPermanent',
          })
          .pipe(Effect.andThen(Effect.fail(error))),
    }),
    Effect.tapCause(() =>
      storage
        .releaseCandidateFreeze({
          workflowRunId: workflowRun.id,
          leaseToken: freezeLeaseToken,
          traceId: workflowRun.traceId,
          operation: 'freezeIncomingPullRequestCandidate.releaseFreeze',
        })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning('Failed to release candidate freeze lease', {
              workflowRunId: workflowRun.id,
              cause,
            }),
          ),
        ),
    ),
  )
})
