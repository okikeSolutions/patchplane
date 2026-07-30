import { Effect, Redacted } from 'effect'
import { ConvexHttpClient } from 'convex/browser'
import {
  decodePolicyDecision,
  decodeProvenanceEvent,
  decodePublicationResult,
  decodeReviewFinding,
  decodeReviewRun,
} from '@patchplane/domain/decision-review'
import { StorageError } from '@patchplane/domain/errors'
import {
  type RecordPolicyDecisionInput,
  type RecordProvenanceEventInput,
  type RecordPublicationResultInput,
  type RecordReviewFindingInput,
  type RecordReviewRunInput,
} from '@patchplane/core/services/storage-service'
import {
  recordReviewRunMutation,
  recordReviewFindingMutation,
  recordPolicyDecisionMutation,
  recordPublicationResultMutation,
  recordProvenanceEventMutation,
} from './shared'

export interface ConvexStorageContext {
  readonly convexUrl: string
  readonly systemIngestionSecret:
    | import('effect').Redacted.Redacted<string>
    | undefined
}

export function makeReviewStorageOperations(context: ConvexStorageContext) {
  const { convexUrl, systemIngestionSecret } = context

  const recordReviewRun = Effect.fn(
    '@patchplane/plugins/convex/recordReviewRun',
  )(function* (input: RecordReviewRunInput) {
    if (systemIngestionSecret === undefined) {
      return yield* new StorageError({
        operation: 'recordReviewRun.config',
        message:
          'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to record review runs',
        cause: undefined,
      })
    }
    const value = yield* Effect.tryPromise({
      try: () => {
        const client = new ConvexHttpClient(convexUrl)
        return client.mutation(recordReviewRunMutation, {
          systemSecret: Redacted.value(systemIngestionSecret),
          workflowRunId: input.workflowRunId,
          ...(input.sandboxExecutionId === undefined
            ? {}
            : { sandboxExecutionId: input.sandboxExecutionId }),
          ...(input.candidatePatchSetId === undefined
            ? {}
            : { candidatePatchSetId: input.candidatePatchSetId }),
          kind: input.kind,
          reviewer: input.reviewer,
          status: input.status,
          ...(input.summary === undefined ? {} : { summary: input.summary }),
          startedAt: input.startedAt,
          ...(input.completedAt === undefined
            ? {}
            : { completedAt: input.completedAt }),
          idempotencyKey: input.idempotencyKey,
          ...(input.createdAt === undefined
            ? {}
            : { createdAt: input.createdAt }),
        })
      },
      catch: (cause) =>
        new StorageError({
          operation: 'recordReviewRun',
          message: 'Convex failed to record review run',
          cause,
        }),
    })
    return yield* decodeReviewRun(value).pipe(
      Effect.mapError(
        (cause) =>
          new StorageError({
            operation: 'recordReviewRun.decode',
            message: 'Convex returned invalid review run',
            cause,
          }),
      ),
    )
  })

  const recordReviewFinding = Effect.fn(
    '@patchplane/plugins/convex/recordReviewFinding',
  )(function* (input: RecordReviewFindingInput) {
    if (systemIngestionSecret === undefined) {
      return yield* new StorageError({
        operation: 'recordReviewFinding.config',
        message:
          'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to record review findings',
        cause: undefined,
      })
    }
    const value = yield* Effect.tryPromise({
      try: () => {
        const client = new ConvexHttpClient(convexUrl)
        return client.mutation(recordReviewFindingMutation, {
          systemSecret: Redacted.value(systemIngestionSecret),
          workflowRunId: input.workflowRunId,
          ...(input.reviewRunId === undefined
            ? {}
            : { reviewRunId: input.reviewRunId }),
          severity: input.severity,
          category: input.category,
          message: input.message,
          ...(input.path === undefined ? {} : { path: input.path }),
          ...(input.startLine === undefined
            ? {}
            : { startLine: input.startLine }),
          ...(input.endLine === undefined ? {} : { endLine: input.endLine }),
          ...(input.evidenceArtifactId === undefined
            ? {}
            : { evidenceArtifactId: input.evidenceArtifactId }),
          idempotencyKey: input.idempotencyKey,
          ...(input.createdAt === undefined
            ? {}
            : { createdAt: input.createdAt }),
        })
      },
      catch: (cause) =>
        new StorageError({
          operation: 'recordReviewFinding',
          message: 'Convex failed to record review finding',
          cause,
        }),
    })
    return yield* decodeReviewFinding(value).pipe(
      Effect.mapError(
        (cause) =>
          new StorageError({
            operation: 'recordReviewFinding.decode',
            message: 'Convex returned invalid review finding',
            cause,
          }),
      ),
    )
  })

  const recordPolicyDecision = Effect.fn(
    '@patchplane/plugins/convex/recordPolicyDecision',
  )(function* (input: RecordPolicyDecisionInput) {
    if (systemIngestionSecret === undefined) {
      return yield* new StorageError({
        operation: 'recordPolicyDecision.config',
        message:
          'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to record policy decisions',
        cause: undefined,
      })
    }
    const value = yield* Effect.tryPromise({
      try: () => {
        const client = new ConvexHttpClient(convexUrl)
        return client.mutation(recordPolicyDecisionMutation, {
          systemSecret: Redacted.value(systemIngestionSecret),
          workflowRunId: input.workflowRunId,
          ...(input.reviewRunId === undefined
            ? {}
            : { reviewRunId: input.reviewRunId }),
          ...(input.candidatePatchSetId === undefined
            ? {}
            : { candidatePatchSetId: input.candidatePatchSetId }),
          status: input.status,
          summary: input.summary,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
          ...(input.policyVersion === undefined
            ? {}
            : { policyVersion: input.policyVersion }),
          ...(input.inputDigest === undefined
            ? {}
            : { inputDigest: input.inputDigest }),
          ...(input.verificationResultIds === undefined
            ? {}
            : { verificationResultIds: input.verificationResultIds }),
          ...(input.reviewFindingIds === undefined
            ? {}
            : { reviewFindingIds: input.reviewFindingIds }),
          ...(input.missingRequirementIds === undefined
            ? {}
            : { missingRequirementIds: input.missingRequirementIds }),
          idempotencyKey: input.idempotencyKey,
          ...(input.createdAt === undefined
            ? {}
            : { createdAt: input.createdAt }),
        })
      },
      catch: (cause) =>
        new StorageError({
          operation: 'recordPolicyDecision',
          message: 'Convex failed to record policy decision',
          cause,
        }),
    })
    return yield* decodePolicyDecision(value).pipe(
      Effect.mapError(
        (cause) =>
          new StorageError({
            operation: 'recordPolicyDecision.decode',
            message: 'Convex returned invalid policy decision',
            cause,
          }),
      ),
    )
  })

  const recordPublicationResult = Effect.fn(
    '@patchplane/plugins/convex/recordPublicationResult',
  )(function* (input: RecordPublicationResultInput) {
    if (systemIngestionSecret === undefined) {
      return yield* new StorageError({
        operation: 'recordPublicationResult.config',
        message:
          'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to record publication results',
        cause: undefined,
      })
    }
    const value = yield* Effect.tryPromise({
      try: () => {
        const client = new ConvexHttpClient(convexUrl)
        return client.mutation(recordPublicationResultMutation, {
          systemSecret: Redacted.value(systemIngestionSecret),
          workflowRunId: input.workflowRunId,
          ...(input.humanDecisionId === undefined
            ? {}
            : { humanDecisionId: input.humanDecisionId }),
          ...(input.candidatePatchSetId === undefined
            ? {}
            : { candidatePatchSetId: input.candidatePatchSetId }),
          ...(input.targetSha === undefined
            ? {}
            : { targetSha: input.targetSha }),
          provider: input.provider,
          kind: input.kind,
          status: input.status,
          ...(input.externalId === undefined
            ? {}
            : { externalId: input.externalId }),
          ...(input.url === undefined ? {} : { url: input.url }),
          ...(input.summary === undefined ? {} : { summary: input.summary }),
          ...(input.error === undefined ? {} : { error: input.error }),
          ...(input.dispatchToken === undefined
            ? {}
            : { dispatchToken: input.dispatchToken }),
          ...(input.createdAt === undefined
            ? {}
            : { createdAt: input.createdAt }),
          ...(input.idempotencyKey === undefined
            ? {}
            : { idempotencyKey: input.idempotencyKey }),
        })
      },
      catch: (cause) =>
        new StorageError({
          operation: 'recordPublicationResult',
          message: 'Convex failed to record publication result',
          cause,
        }),
    })
    return yield* decodePublicationResult(value).pipe(
      Effect.mapError(
        (cause) =>
          new StorageError({
            operation: 'recordPublicationResult.decode',
            message: 'Convex returned invalid publication result',
            cause,
          }),
      ),
    )
  })

  const recordProvenanceEvent = Effect.fn(
    '@patchplane/plugins/convex/recordProvenanceEvent',
  )(function* (input: RecordProvenanceEventInput) {
    if (systemIngestionSecret === undefined) {
      return yield* new StorageError({
        operation: 'recordProvenanceEvent.config',
        message:
          'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to record provenance events',
        cause: undefined,
      })
    }
    const value = yield* Effect.tryPromise({
      try: () => {
        const client = new ConvexHttpClient(convexUrl)
        return client.mutation(recordProvenanceEventMutation, {
          systemSecret: Redacted.value(systemIngestionSecret),
          workflowRunId: input.workflowRunId,
          traceId: input.traceId,
          ...(input.parentEventId === undefined
            ? {}
            : { parentEventId: input.parentEventId }),
          type: input.type,
          operation: input.operation,
          ...(input.pluginName === undefined
            ? {}
            : { pluginName: input.pluginName }),
          status: input.status,
          startedAt: input.startedAt,
          ...(input.completedAt === undefined
            ? {}
            : { completedAt: input.completedAt }),
          ...(input.summary === undefined ? {} : { summary: input.summary }),
          artifactRefs: input.artifactRefs ?? [],
          ...(input.errorCategory === undefined
            ? {}
            : { errorCategory: input.errorCategory }),
          ...(input.idempotencyKey === undefined
            ? {}
            : { idempotencyKey: input.idempotencyKey }),
        })
      },
      catch: (cause) =>
        new StorageError({
          operation: 'recordProvenanceEvent',
          message: 'Convex failed to record provenance event',
          cause,
        }),
    })
    return yield* decodeProvenanceEvent(value).pipe(
      Effect.mapError(
        (cause) =>
          new StorageError({
            operation: 'recordProvenanceEvent.decode',
            message: 'Convex returned invalid provenance event',
            cause,
          }),
      ),
    )
  })

  return {
    recordReviewRun,
    recordReviewFinding,
    recordPolicyDecision,
    recordPublicationResult,
    recordProvenanceEvent,
  }
}
