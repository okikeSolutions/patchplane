import { Effect, Option, Redacted, Schema } from 'effect'
import { convexMutation, convexQuery } from '../http-client'
import { decodeCandidatePatchSet } from '@patchplane/domain/decision-review'
import { StorageError } from '@patchplane/domain/errors'
import {
  type CandidateFreezeInput,
  type FailCandidateFreezeInput,
  type GetCandidatePatchSetForWorkflowInput,
  type IncomingDispatchClaimInput,
  type StartIncomingDispatchInput,
  type RecordCandidatePatchSetInput,
} from '@patchplane/core/services/storage-service'
import {
  getCandidatePatchSetForWorkflowQuery,
  claimCandidateFreezeMutation,
  releaseCandidateFreezeMutation,
  failCandidateFreezeMutation,
  claimIncomingDispatchMutation,
  startIncomingDispatchMutation,
  validateIncomingDispatchMutation,
  recordCandidatePatchSetMutation,
} from './shared'

export interface ConvexStorageContext {
  readonly convexUrl: string
  readonly systemIngestionSecret:
    | import('effect').Redacted.Redacted<string>
    | undefined
}

export function makeCandidatesStorageOperations(context: ConvexStorageContext) {
  const { convexUrl, systemIngestionSecret } = context

  const getCandidatePatchSetForWorkflow = Effect.fn(
    '@patchplane/plugins/convex/getCandidatePatchSetForWorkflow',
  )(function* (input: GetCandidatePatchSetForWorkflowInput) {
    if (systemIngestionSecret === undefined) {
      return yield* new StorageError({
        operation: 'getCandidatePatchSetForWorkflow.config',
        message:
          'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to read candidates',
        cause: undefined,
      })
    }
    const value = yield* convexQuery({
      url: convexUrl,
      reference: getCandidatePatchSetForWorkflowQuery,
      args: {
        systemSecret: Redacted.value(systemIngestionSecret),
        workflowRunId: input.workflowRunId,
      },
      catch: (cause) =>
        new StorageError({
          operation: 'getCandidatePatchSetForWorkflow',
          message: 'Convex failed to read the workflow candidate',
          cause,
        }),
    })
    if (value === null) return Option.none()
    return Option.some(
      yield* decodeCandidatePatchSet(value).pipe(
        Effect.mapError(
          (cause) =>
            new StorageError({
              operation: 'getCandidatePatchSetForWorkflow.decode',
              message: 'Convex returned an invalid workflow candidate',
              cause,
            }),
        ),
      ),
    )
  })

  const candidateFreezeMutation = (
    operation: 'claimCandidateFreeze' | 'releaseCandidateFreeze',
    mutationRef:
      | typeof claimCandidateFreezeMutation
      | typeof releaseCandidateFreezeMutation,
    input: CandidateFreezeInput,
  ) =>
    Effect.gen(function* () {
      if (systemIngestionSecret === undefined) {
        return yield* new StorageError({
          operation: `${operation}.config`,
          message:
            'PATCHPLANE_SYSTEM_INGESTION_SECRET is required for candidate freeze coordination',
          cause: undefined,
        })
      }
      const result = yield* convexMutation({
        url: convexUrl,
        reference: mutationRef,
        args: {
          systemSecret: Redacted.value(systemIngestionSecret),
          workflowRunId: input.workflowRunId,
          leaseToken: input.leaseToken,
        },
        catch: (cause) =>
          new StorageError({
            operation,
            message: `Convex failed to ${operation}`,
            cause,
          }),
      })
      return yield* Schema.decodeUnknownEffect(Schema.Boolean)(result).pipe(
        Effect.mapError(
          (cause) =>
            new StorageError({
              operation: `${operation}.decode`,
              message: `Convex returned an invalid ${operation} result`,
              cause,
            }),
        ),
      )
    })

  const claimCandidateFreeze = Effect.fn(
    '@patchplane/plugins/convex/claimCandidateFreeze',
  )((input: CandidateFreezeInput) =>
    candidateFreezeMutation(
      'claimCandidateFreeze',
      claimCandidateFreezeMutation,
      input,
    ),
  )

  const releaseCandidateFreeze = Effect.fn(
    '@patchplane/plugins/convex/releaseCandidateFreeze',
  )((input: CandidateFreezeInput) =>
    candidateFreezeMutation(
      'releaseCandidateFreeze',
      releaseCandidateFreezeMutation,
      input,
    ),
  )

  const failCandidateFreeze = (input: FailCandidateFreezeInput) =>
    Effect.gen(function* () {
      if (systemIngestionSecret === undefined) {
        return yield* new StorageError({
          operation: 'failCandidateFreeze.config',
          message:
            'PATCHPLANE_SYSTEM_INGESTION_SECRET is required for candidate freeze coordination',
          cause: undefined,
        })
      }
      const result = yield* convexMutation({
        url: convexUrl,
        reference: failCandidateFreezeMutation,
        args: {
          systemSecret: Redacted.value(systemIngestionSecret),
          workflowRunId: input.workflowRunId,
          leaseToken: input.leaseToken,
          summary: input.summary,
        },
        catch: (cause) =>
          new StorageError({
            operation: 'failCandidateFreeze',
            message: 'Convex failed to persist candidate freeze failure',
            cause,
          }),
      })
      return yield* Schema.decodeUnknownEffect(Schema.Boolean)(result).pipe(
        Effect.mapError(
          (cause) =>
            new StorageError({
              operation: 'failCandidateFreeze.decode',
              message:
                'Convex returned an invalid candidate freeze failure result',
              cause,
            }),
        ),
      )
    })

  const incomingDispatchMutation = (
    operation:
      | 'claimIncomingDispatch'
      | 'startIncomingDispatch'
      | 'validateIncomingDispatch',
    mutationRef:
      | typeof claimIncomingDispatchMutation
      | typeof startIncomingDispatchMutation
      | typeof validateIncomingDispatchMutation,
    input: IncomingDispatchClaimInput | StartIncomingDispatchInput,
  ) =>
    Effect.gen(function* () {
      if (systemIngestionSecret === undefined) {
        return yield* new StorageError({
          operation: `${operation}.config`,
          message:
            'PATCHPLANE_SYSTEM_INGESTION_SECRET is required for incoming dispatch coordination',
          cause: undefined,
        })
      }
      const result = yield* convexMutation({
        url: convexUrl,
        reference: mutationRef,
        args: {
          systemSecret: Redacted.value(systemIngestionSecret),
          workflowRunId: input.workflowRunId,
          candidatePatchSetId: input.candidatePatchSetId,
          dispatchToken: input.dispatchToken,
          ...(operation === 'startIncomingDispatch' && 'sandboxId' in input
            ? {
                sandboxId: input.sandboxId,
              }
            : {}),
        },
        catch: (cause) =>
          new StorageError({
            operation,
            message: `Convex failed to ${operation}`,
            cause,
          }),
      })
      return yield* Schema.decodeUnknownEffect(Schema.Boolean)(result).pipe(
        Effect.mapError(
          (cause) =>
            new StorageError({
              operation: `${operation}.decode`,
              message: `Convex returned an invalid ${operation} result`,
              cause,
            }),
        ),
      )
    })

  const claimIncomingDispatch = Effect.fn(
    '@patchplane/plugins/convex/claimIncomingDispatch',
  )((input: IncomingDispatchClaimInput) =>
    incomingDispatchMutation(
      'claimIncomingDispatch',
      claimIncomingDispatchMutation,
      input,
    ),
  )

  const startIncomingDispatch = Effect.fn(
    '@patchplane/plugins/convex/startIncomingDispatch',
  )((input: StartIncomingDispatchInput) =>
    incomingDispatchMutation(
      'startIncomingDispatch',
      startIncomingDispatchMutation,
      input,
    ),
  )

  const validateIncomingDispatch = Effect.fn(
    '@patchplane/plugins/convex/validateIncomingDispatch',
  )((input: IncomingDispatchClaimInput) =>
    incomingDispatchMutation(
      'validateIncomingDispatch',
      validateIncomingDispatchMutation,
      input,
    ),
  )

  const recordCandidatePatchSet = Effect.fn(
    '@patchplane/plugins/convex/recordCandidatePatchSet',
  )(function* (input: RecordCandidatePatchSetInput) {
    if (systemIngestionSecret === undefined) {
      return yield* new StorageError({
        operation: 'recordCandidatePatchSet.config',
        message:
          'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to record candidate patch sets',
        cause: undefined,
      })
    }
    const value = yield* convexMutation({
      url: convexUrl,
      reference: recordCandidatePatchSetMutation,
      args: {
        systemSecret: Redacted.value(systemIngestionSecret),
        workflowRunId: input.workflowRunId,
        ...(input.sandboxExecutionId === undefined
          ? {}
          : { sandboxExecutionId: input.sandboxExecutionId }),
        ...(input.subject === undefined ? {} : { subject: input.subject }),
        ...(input.candidateFreezeLeaseToken === undefined
          ? {}
          : {
              candidateFreezeLeaseToken: input.candidateFreezeLeaseToken,
            }),
        status: input.status,
        ...(input.candidateDigest === undefined
          ? {}
          : { candidateDigest: input.candidateDigest }),
        ...(input.baseRef === undefined ? {} : { baseRef: input.baseRef }),
        ...(input.baseSha === undefined ? {} : { baseSha: input.baseSha }),
        ...(input.headRef === undefined ? {} : { headRef: input.headRef }),
        ...(input.headSha === undefined ? {} : { headSha: input.headSha }),
        ...(input.diffArtifactId === undefined
          ? {}
          : { diffArtifactId: input.diffArtifactId }),
        ...(input.summary === undefined ? {} : { summary: input.summary }),
        ...(input.stats === undefined ? {} : { stats: input.stats }),
        idempotencyKey: input.idempotencyKey,
        createdAt: input.createdAt,
      },
      catch: (cause) =>
        new StorageError({
          operation: 'recordCandidatePatchSet',
          message: 'Convex failed to record candidate patch set',
          cause,
        }),
    })
    return yield* decodeCandidatePatchSet(value).pipe(
      Effect.mapError(
        (cause) =>
          new StorageError({
            operation: 'recordCandidatePatchSet.decode',
            message: 'Convex returned invalid candidate patch set',
            cause,
          }),
      ),
    )
  })

  return {
    getCandidatePatchSetForWorkflow,
    claimCandidateFreeze,
    releaseCandidateFreeze,
    failCandidateFreeze,
    claimIncomingDispatch,
    startIncomingDispatch,
    validateIncomingDispatch,
    recordCandidatePatchSet,
  }
}
