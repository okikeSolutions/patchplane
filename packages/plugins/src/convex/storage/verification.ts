import { Effect, Redacted, Schema } from 'effect'
import { ConvexHttpClient } from 'convex/browser'
import { StorageError } from '@patchplane/domain/errors'
import { SandboxExecution } from '@patchplane/domain/sandbox-execution'
import {
  decodeVerificationExecutionGroup,
  decodeVerificationPlanV1,
  VerificationExecutionGroup,
  VerificationResult,
  decodeVerificationRequirement,
  decodeVerificationResult,
} from '@patchplane/domain/verification'
import {
  type ClaimVerificationExecutionGroupInput,
  type FailVerificationExecutionGroupInput,
  type StartIncomingVerificationPlanInput,
  type StartVerificationExecutionGroupInput,
  type GetVerificationExecutionStateInput,
  type RecordVerificationExecutionCommandInput,
  type RecordVerificationPlanInput,
  type RecordVerificationRequirementInput,
  type RecordVerificationResultInput,
} from '@patchplane/core/services/storage-service'
import {
  settleWithin,
  recordVerificationPlanMutation,
  recordVerificationRequirementMutation,
  startIncomingVerificationPlanMutation,
  claimVerificationExecutionGroupMutation,
  startVerificationExecutionGroupMutation,
  recordVerificationExecutionCommandMutation,
  failVerificationExecutionGroupMutation,
  getVerificationExecutionStateQuery,
  recordVerificationResultMutation,
} from './shared'

export interface ConvexStorageContext {
  readonly convexUrl: string
  readonly systemIngestionSecret:
    | import('effect').Redacted.Redacted<string>
    | undefined
}

export function makeVerificationStorageOperations(
  context: ConvexStorageContext,
) {
  const { convexUrl, systemIngestionSecret } = context

  const recordVerificationPlan = Effect.fn(
    '@patchplane/plugins/convex/recordVerificationPlan',
  )(function* (input: RecordVerificationPlanInput) {
    if (systemIngestionSecret === undefined) {
      return yield* new StorageError({
        operation: 'recordVerificationPlan.config',
        message:
          'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to record verification plans',
        cause: undefined,
      })
    }
    const value = yield* Effect.tryPromise({
      try: () =>
        new ConvexHttpClient(convexUrl).mutation(
          recordVerificationPlanMutation,
          {
            systemSecret: Redacted.value(systemIngestionSecret),
            workflowRunId: input.workflowRunId,
            version: input.version,
            sources: input.sources,
            requirements: input.requirements,
            digest: input.digest,
            createdAt: input.createdAt,
          },
        ),
      catch: (cause) =>
        new StorageError({
          operation: 'recordVerificationPlan',
          message: 'Convex failed to record verification plan',
          cause,
        }),
    })
    return yield* decodeVerificationPlanV1(value).pipe(
      Effect.mapError(
        (cause) =>
          new StorageError({
            operation: 'recordVerificationPlan.decode',
            message: 'Convex returned an invalid verification plan',
            cause,
          }),
      ),
    )
  })

  const recordVerificationRequirement = Effect.fn(
    '@patchplane/plugins/convex/recordVerificationRequirement',
  )(function* (input: RecordVerificationRequirementInput) {
    if (systemIngestionSecret === undefined) {
      return yield* new StorageError({
        operation: 'recordVerificationRequirement.config',
        message:
          'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to record verification requirements',
        cause: undefined,
      })
    }
    const value = yield* Effect.tryPromise({
      try: () =>
        new ConvexHttpClient(convexUrl).mutation(
          recordVerificationRequirementMutation,
          {
            systemSecret: Redacted.value(systemIngestionSecret),
            workflowRunId: input.workflowRunId,
            ...(input.verificationPlanId === undefined
              ? {}
              : { verificationPlanId: input.verificationPlanId }),
            key: input.key,
            label: input.label,
            kind: input.kind,
            required: input.required,
            ...(input.command === undefined ? {} : { command: input.command }),
            ...(input.platform === undefined
              ? {}
              : { platform: input.platform }),
            ...(input.architecture === undefined
              ? {}
              : { architecture: input.architecture }),
            ...(input.timeoutSeconds === undefined
              ? {}
              : { timeoutSeconds: input.timeoutSeconds }),
            requiredArtifactKinds: input.requiredArtifactKinds,
            source: input.source,
            createdAt: input.createdAt,
          },
        ),
      catch: (cause) =>
        new StorageError({
          operation: 'recordVerificationRequirement',
          message: 'Convex failed to record verification requirement',
          cause,
        }),
    })
    return yield* decodeVerificationRequirement(value).pipe(
      Effect.mapError(
        (cause) =>
          new StorageError({
            operation: 'recordVerificationRequirement.decode',
            message: 'Convex returned invalid verification requirement',
            cause,
          }),
      ),
    )
  })

  const startIncomingVerificationPlan = Effect.fn(
    '@patchplane/plugins/convex/startIncomingVerificationPlan',
  )(function* (input: StartIncomingVerificationPlanInput) {
    if (systemIngestionSecret === undefined) {
      return yield* new StorageError({
        operation: 'startIncomingVerificationPlan.config',
        message:
          'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to start incoming verification plans',
        cause: undefined,
      })
    }
    const value = yield* Effect.tryPromise({
      try: () =>
        new ConvexHttpClient(convexUrl).mutation(
          startIncomingVerificationPlanMutation,
          {
            systemSecret: Redacted.value(systemIngestionSecret),
            workflowRunId: input.workflowRunId,
            verificationPlanId: input.verificationPlanId,
            candidatePatchSetId: input.candidatePatchSetId,
            incomingDispatchToken: input.incomingDispatchToken,
          },
        ),
      catch: (cause) =>
        new StorageError({
          operation: 'startIncomingVerificationPlan',
          message: 'Convex failed to start incoming verification plan',
          cause,
        }),
    })
    return yield* Schema.decodeUnknownEffect(Schema.Boolean)(value).pipe(
      Effect.mapError(
        (cause) =>
          new StorageError({
            operation: 'startIncomingVerificationPlan.decode',
            message: 'Convex returned invalid verification-plan start result',
            cause,
          }),
      ),
    )
  })

  const claimVerificationExecutionGroup = Effect.fn(
    '@patchplane/plugins/convex/claimVerificationExecutionGroup',
  )(function* (input: ClaimVerificationExecutionGroupInput) {
    if (systemIngestionSecret === undefined) {
      return yield* new StorageError({
        operation: 'claimVerificationExecutionGroup.config',
        message:
          'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to claim verification execution groups',
        cause: undefined,
      })
    }
    const value = yield* Effect.tryPromise({
      try: () =>
        new ConvexHttpClient(convexUrl).mutation(
          claimVerificationExecutionGroupMutation,
          {
            systemSecret: Redacted.value(systemIngestionSecret),
            workflowRunId: input.workflowRunId,
            verificationPlanId: input.verificationPlanId,
            requirementId: input.requirementId,
            candidatePatchSetId: input.candidatePatchSetId,
            stableKey: input.stableKey,
            claimToken: input.claimToken,
            incomingDispatchToken: input.incomingDispatchToken,
            provider: input.provider,
            platform: input.platform,
            architecture: input.architecture,
            ...(input.commandDigest === undefined
              ? {}
              : { commandDigest: input.commandDigest }),
            ...(input.timeoutSeconds === undefined
              ? {}
              : { timeoutSeconds: input.timeoutSeconds }),
            claimedAt: input.claimedAt,
          },
        ),
      catch: (cause) =>
        new StorageError({
          operation: 'claimVerificationExecutionGroup',
          message: 'Convex failed to claim verification execution group',
          cause,
        }),
    })
    if (value === null) return undefined
    return yield* decodeVerificationExecutionGroup(value).pipe(
      Effect.mapError(
        (cause) =>
          new StorageError({
            operation: 'claimVerificationExecutionGroup.decode',
            message: 'Convex returned invalid verification execution group',
            cause,
          }),
      ),
    )
  })

  const startVerificationExecutionGroup = Effect.fn(
    '@patchplane/plugins/convex/startVerificationExecutionGroup',
  )(function* (input: StartVerificationExecutionGroupInput) {
    if (systemIngestionSecret === undefined) {
      return yield* new StorageError({
        operation: 'startVerificationExecutionGroup.config',
        message:
          'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to start verification execution groups',
        cause: undefined,
      })
    }
    const value = yield* Effect.tryPromise({
      try: () =>
        new ConvexHttpClient(convexUrl).mutation(
          startVerificationExecutionGroupMutation,
          {
            systemSecret: Redacted.value(systemIngestionSecret),
            workflowRunId: input.workflowRunId,
            executionGroupId: input.executionGroupId,
            claimToken: input.claimToken,
            sandboxId: input.sandboxId,
          },
        ),
      catch: (cause) =>
        new StorageError({
          operation: 'startVerificationExecutionGroup',
          message: 'Convex failed to start verification execution group',
          cause,
        }),
    })
    return yield* Schema.decodeUnknownEffect(Schema.Boolean)(value).pipe(
      Effect.mapError(
        (cause) =>
          new StorageError({
            operation: 'startVerificationExecutionGroup.decode',
            message: 'Convex returned invalid execution-group start result',
            cause,
          }),
      ),
    )
  })

  const recordVerificationExecutionCommand = Effect.fn(
    '@patchplane/plugins/convex/recordVerificationExecutionCommand',
  )(function* (input: RecordVerificationExecutionCommandInput) {
    if (systemIngestionSecret === undefined) {
      return yield* new StorageError({
        operation: 'recordVerificationExecutionCommand.config',
        message:
          'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to record verification command identity',
        cause: undefined,
      })
    }
    const value = yield* Effect.tryPromise({
      try: () =>
        new ConvexHttpClient(convexUrl).mutation(
          recordVerificationExecutionCommandMutation,
          {
            systemSecret: Redacted.value(systemIngestionSecret),
            workflowRunId: input.workflowRunId,
            executionGroupId: input.executionGroupId,
            claimToken: input.claimToken,
            sandboxId: input.sandboxId,
            providerSessionId: input.providerSessionId,
            providerCommandId: input.providerCommandId,
          },
        ),
      catch: (cause) =>
        new StorageError({
          operation: 'recordVerificationExecutionCommand',
          message: 'Convex failed to record verification command identity',
          cause,
        }),
    })
    return yield* Schema.decodeUnknownEffect(Schema.Boolean)(value).pipe(
      Effect.mapError(
        (cause) =>
          new StorageError({
            operation: 'recordVerificationExecutionCommand.decode',
            message:
              'Convex returned invalid verification command identity result',
            cause,
          }),
      ),
    )
  })

  const failVerificationExecutionGroup = Effect.fn(
    '@patchplane/plugins/convex/failVerificationExecutionGroup',
  )(function* (input: FailVerificationExecutionGroupInput) {
    if (systemIngestionSecret === undefined) {
      return yield* new StorageError({
        operation: 'failVerificationExecutionGroup.config',
        message:
          'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to fail verification execution groups',
        cause: undefined,
      })
    }
    const value = yield* Effect.tryPromise({
      try: () =>
        new ConvexHttpClient(convexUrl).mutation(
          failVerificationExecutionGroupMutation,
          {
            systemSecret: Redacted.value(systemIngestionSecret),
            workflowRunId: input.workflowRunId,
            executionGroupId: input.executionGroupId,
            claimToken: input.claimToken,
            status: input.status,
            completedAt: input.completedAt,
          },
        ),
      catch: (cause) =>
        new StorageError({
          operation: 'failVerificationExecutionGroup',
          message: 'Convex failed to fail verification execution group',
          cause,
        }),
    })
    return yield* Schema.decodeUnknownEffect(Schema.Boolean)(value).pipe(
      Effect.mapError(
        (cause) =>
          new StorageError({
            operation: 'failVerificationExecutionGroup.decode',
            message: 'Convex returned invalid execution-group failure result',
            cause,
          }),
      ),
    )
  })

  const getVerificationExecutionState = Effect.fn(
    '@patchplane/plugins/convex/getVerificationExecutionState',
  )(function* (input: GetVerificationExecutionStateInput) {
    if (systemIngestionSecret === undefined) {
      return yield* new StorageError({
        operation: 'getVerificationExecutionState.config',
        message:
          'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to read verification execution state',
        cause: undefined,
      })
    }
    const value = yield* Effect.tryPromise({
      try: () =>
        new ConvexHttpClient(convexUrl).query(
          getVerificationExecutionStateQuery,
          {
            systemSecret: Redacted.value(systemIngestionSecret),
            workflowRunId: input.workflowRunId,
            verificationPlanId: input.verificationPlanId,
            candidatePatchSetId: input.candidatePatchSetId,
          },
        ),
      catch: (cause) =>
        new StorageError({
          operation: 'getVerificationExecutionState',
          message: 'Convex failed to read verification execution state',
          cause,
        }),
    })
    return yield* Schema.decodeUnknownEffect(
      Schema.Struct({
        groups: Schema.Array(VerificationExecutionGroup),
        results: Schema.Array(VerificationResult),
        sandboxExecutions: Schema.Array(SandboxExecution),
      }),
    )(value).pipe(
      Effect.mapError(
        (cause) =>
          new StorageError({
            operation: 'getVerificationExecutionState.decode',
            message: 'Convex returned invalid verification execution state',
            cause,
          }),
      ),
    )
  })

  const recordVerificationResult = Effect.fn(
    '@patchplane/plugins/convex/recordVerificationResult',
  )(function* (input: RecordVerificationResultInput) {
    if (systemIngestionSecret === undefined) {
      return yield* new StorageError({
        operation: 'recordVerificationResult.config',
        message:
          'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to record verification results',
        cause: undefined,
      })
    }
    const value = yield* settleWithin({
      promise: new ConvexHttpClient(convexUrl).mutation(
        recordVerificationResultMutation,
        {
          systemSecret: Redacted.value(systemIngestionSecret),
          workflowRunId: input.workflowRunId,
          ...(input.verificationPlanId === undefined
            ? {}
            : { verificationPlanId: input.verificationPlanId }),
          ...(input.executionGroupId === undefined
            ? {}
            : { executionGroupId: input.executionGroupId }),
          ...(input.executionGroupClaimToken === undefined
            ? {}
            : {
                executionGroupClaimToken: input.executionGroupClaimToken,
              }),
          requirementId: input.requirementId,
          candidatePatchSetId: input.candidatePatchSetId,
          ...(input.sandboxExecutionId === undefined
            ? {}
            : { sandboxExecutionId: input.sandboxExecutionId }),
          provider: input.provider,
          ...(input.command === undefined ? {} : { command: input.command }),
          ...(input.commandDigest === undefined
            ? {}
            : { commandDigest: input.commandDigest }),
          platform: input.platform,
          architecture: input.architecture,
          ...(input.environmentImage === undefined
            ? {}
            : { environmentImage: input.environmentImage }),
          ...(input.providerSessionId === undefined
            ? {}
            : { providerSessionId: input.providerSessionId }),
          ...(input.providerCommandId === undefined
            ? {}
            : { providerCommandId: input.providerCommandId }),
          status: input.status,
          ...(input.exitCode === undefined ? {} : { exitCode: input.exitCode }),
          ...(input.summary === undefined ? {} : { summary: input.summary }),
          ...(input.passedCount === undefined
            ? {}
            : { passedCount: input.passedCount }),
          ...(input.failedCount === undefined
            ? {}
            : { failedCount: input.failedCount }),
          ...(input.skippedCount === undefined
            ? {}
            : { skippedCount: input.skippedCount }),
          artifactIds: input.artifactIds,
          ...(input.stdoutArtifactId === undefined
            ? {}
            : { stdoutArtifactId: input.stdoutArtifactId }),
          ...(input.stderrArtifactId === undefined
            ? {}
            : { stderrArtifactId: input.stderrArtifactId }),
          ...(input.stdoutCaptureStatus === undefined
            ? {}
            : { stdoutCaptureStatus: input.stdoutCaptureStatus }),
          ...(input.stderrCaptureStatus === undefined
            ? {}
            : { stderrCaptureStatus: input.stderrCaptureStatus }),
          ...(input.cleanupStatus === undefined
            ? {}
            : { cleanupStatus: input.cleanupStatus }),
          ...(input.candidateDigestBefore === undefined
            ? {}
            : { candidateDigestBefore: input.candidateDigestBefore }),
          ...(input.candidateDigestAfter === undefined
            ? {}
            : { candidateDigestAfter: input.candidateDigestAfter }),
          startedAt: input.startedAt,
          ...(input.completedAt === undefined
            ? {}
            : { completedAt: input.completedAt }),
          idempotencyKey: input.idempotencyKey,
        },
      ),
      timeoutMs: 15_000,
      operation: 'recordVerificationResult',
      message: 'Convex failed to record verification result',
    })
    return yield* decodeVerificationResult(value).pipe(
      Effect.mapError(
        (cause) =>
          new StorageError({
            operation: 'recordVerificationResult.decode',
            message: 'Convex returned invalid verification result',
            cause,
          }),
      ),
    )
  })

  return {
    recordVerificationPlan,
    recordVerificationRequirement,
    startIncomingVerificationPlan,
    claimVerificationExecutionGroup,
    startVerificationExecutionGroup,
    recordVerificationExecutionCommand,
    failVerificationExecutionGroup,
    getVerificationExecutionState,
    recordVerificationResult,
  }
}
