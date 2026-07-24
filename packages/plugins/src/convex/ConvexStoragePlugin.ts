import { Config, Effect, Layer, Option, Redacted } from 'effect'
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import {
  decodeCandidatePatchSet,
  decodePolicyDecision,
  decodeProvenanceEvent,
  decodePublicationResult,
  decodeReviewFinding,
  decodeReviewRun,
} from '@patchplane/domain/decision-review'
import { StorageError } from '@patchplane/domain/errors'
import { decodeEvidenceArtifact } from '@patchplane/domain/evidence-artifact'
import { decodeRuntimeEvents } from '@patchplane/domain/runtime-event'
import { decodeRuntimeSession } from '@patchplane/domain/runtime-session'
import { decodeSandboxExecution } from '@patchplane/domain/sandbox-execution'
import {
  decodeWorkflowStart,
  decodeWorkflowStarts,
  type WorkflowStart,
} from '@patchplane/domain/workflow-start'
import {
  StorageService,
  type CreateWorkflowFromPromptInput,
  type GetActiveRuntimeSessionInput,
  type MarkRuntimeSessionStatusInput,
  type GetEvidenceArtifactInput,
  type RecordEvidenceArtifactInput,
  type RecordCandidatePatchSetInput,
  type RecordPolicyDecisionInput,
  type RecordProvenanceEventInput,
  type RecordPublicationResultInput,
  type RecordReviewFindingInput,
  type RecordReviewRunInput,
  type RecordRuntimeEventInput,
  type RecordRuntimeSessionStartedInput,
  type RecordSandboxExecutionInput,
  type StorageListRecentWorkflowStartsInput,
} from '@patchplane/core/services/storage-service'
import { ConvexConfig } from './ConvexConfig'

interface ExternalWorkflowRefInput {
  readonly provider: string
  readonly deliveryId: string
  readonly eventKind: string
  readonly repositoryProvider?: string | undefined
  readonly repositoryInstallationId?: string | undefined
  readonly repositoryExternalId?: string | undefined
  readonly repositoryOwner?: string | undefined
  readonly repositoryName?: string | undefined
  readonly repositoryFullName?: string | undefined
  readonly issueExternalId?: string | undefined
  readonly issueNumber?: number | undefined
  readonly issueTitle?: string | undefined
  readonly pullRequestExternalId?: string | undefined
  readonly pullRequestNumber?: number | undefined
  readonly pullRequestHeadSha?: string | undefined
  readonly pullRequestHeadRef?: string | undefined
  readonly pullRequestBaseRef?: string | undefined
  readonly commentExternalId?: string | undefined
  readonly url?: string | undefined
  readonly senderProvider?: string | undefined
  readonly senderExternalId?: string | undefined
  readonly senderLogin?: string | undefined
}

const createWorkflowStartMutation = makeFunctionReference<
  'mutation',
  {
    workspaceId: string
    actorId: string
    actorDisplayName: string
    source: 'dev' | 'app' | 'external'
    traceId: string
    prompt: string
  },
  unknown
>('workflowStarts:create')

const createWorkflowStartFromExternalIntakeMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workspaceId: string
    actorId: string
    actorDisplayName: string
    source: 'external'
    traceId: string
    prompt: string
    externalRef: ExternalWorkflowRefInput
  },
  unknown
>('workflowStarts:createFromExternalIntake')

const recordRuntimeEventsMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    events: ReadonlyArray<{
      workflowRunId: string
      provider: string
      type: string
      occurredAt: number
      summary?: string
      payloadJson?: string
      idempotencyKey?: string
      sourceSessionId?: string
      sourceCommandId?: string
      sourceStream?: 'stdout' | 'stderr'
      sourceLine?: number
      sourceOffset?: number
    }>
  },
  unknown
>('workflowStarts:recordRuntimeEvents')

const recordRuntimeSessionStartedMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workflowRunId: string
    provider: string
    sandboxId: string
    sessionId: string
    commandId: string
    startedAt: number
  },
  unknown
>('workflowStarts:recordRuntimeSessionStarted')

const markRuntimeSessionStatusMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    runtimeSessionId: string
    status: 'starting' | 'running' | 'completed' | 'failed' | 'cancelled'
    completedAt?: number
  },
  unknown
>('workflowStarts:markRuntimeSessionStatus')

const getActiveRuntimeSessionQuery = makeFunctionReference<
  'query',
  {
    systemSecret: string
    workflowRunId: string
  },
  unknown
>('workflowStarts:getActiveRuntimeSession')

const recordSandboxExecutionMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workflowRunId: string
    provider: string
    sandboxId: string
    command: string
    status: 'succeeded' | 'failed'
    exitCode?: number
    stdout: string
    stderr?: string
    policy?: Record<string, unknown>
    startedAt: number
    completedAt: number
  },
  unknown
>('workflowStarts:recordSandboxExecution')

const recordEvidenceArtifactMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workflowRunId: string
    traceId?: string
    kind: RecordEvidenceArtifactInput['kind']
    label?: string
    storageProvider: 'cloudflare-r2'
    storageKey: string
    contentType: string
    sizeBytes: number
    sha256: string
    retentionPolicy?: string
    createdAt?: number
  },
  unknown
>('workflowStarts:recordEvidenceArtifact')

const getEvidenceArtifactQuery = makeFunctionReference<
  'query',
  {
    artifactId: string
    workflowRunId?: string
    systemSecret?: string
  },
  unknown
>('workflowStarts:getEvidenceArtifact')

const recordCandidatePatchSetMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workflowRunId: string
    status: RecordCandidatePatchSetInput['status']
    baseRef?: string
    baseSha?: string
    headRef?: string
    headSha?: string
    diffArtifactId?: string
    summary?: string
    stats?: {
      filesChanged: number
      additions: number
      deletions: number
    }
    createdAt?: number
  },
  unknown
>('workflowStarts:recordCandidatePatchSet')

const recordReviewRunMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workflowRunId: string
    sandboxExecutionId?: string
    candidatePatchSetId?: string
    kind: RecordReviewRunInput['kind']
    reviewer: string
    status: RecordReviewRunInput['status']
    summary?: string
    startedAt: number
    completedAt?: number
    createdAt?: number
  },
  unknown
>('workflowStarts:recordReviewRun')

const recordReviewFindingMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workflowRunId: string
    reviewRunId?: string
    severity: RecordReviewFindingInput['severity']
    category: RecordReviewFindingInput['category']
    message: string
    path?: string
    startLine?: number
    endLine?: number
    evidenceArtifactId?: string
    createdAt?: number
  },
  unknown
>('workflowStarts:recordReviewFinding')

const recordPolicyDecisionMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workflowRunId: string
    reviewRunId?: string
    status: RecordPolicyDecisionInput['status']
    summary: string
    reason?: string
    createdAt?: number
  },
  unknown
>('workflowStarts:recordPolicyDecision')

const recordPublicationResultMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workflowRunId: string
    provider: string
    kind: RecordPublicationResultInput['kind']
    status: RecordPublicationResultInput['status']
    externalId?: string
    url?: string
    summary?: string
    error?: string
    createdAt?: number
    idempotencyKey?: string
  },
  unknown
>('workflowStarts:recordPublicationResult')

const recordProvenanceEventMutation = makeFunctionReference<
  'mutation',
  {
    systemSecret: string
    workflowRunId: string
    traceId: string
    parentEventId?: string
    type: string
    operation: string
    pluginName?: string
    status: RecordProvenanceEventInput['status']
    startedAt: number
    completedAt?: number
    summary?: string
    artifactRefs: ReadonlyArray<string>
    errorCategory?: string
    idempotencyKey?: string
  },
  unknown
>('workflowStarts:recordProvenanceEvent')

const listRecentWorkflowStartsQuery = makeFunctionReference<
  'query',
  {
    workspaceId: string
    limit?: number
  },
  unknown
>('workflowStarts:listRecent')

export const ConvexStoragePlugin = {
  layer: Layer.effect(
    StorageService,
    Effect.gen(function* () {
      const config = yield* ConvexConfig
      const convexUrl = config.url.toString().replace(/\/$/, '')
      const systemIngestionSecret = Option.getOrUndefined(
        config.systemIngestionSecret,
      )

      const createWorkflowFromPrompt = Effect.fn(
        '@patchplane/plugins/convex/createWorkflowFromPrompt',
      )(
        (
          input: CreateWorkflowFromPromptInput,
        ): Effect.Effect<WorkflowStart, StorageError> =>
          Effect.gen(function* () {
            yield* Effect.annotateCurrentSpan({
              traceId: input.traceId,
              workspaceId: input.workspaceId,
              actorId: input.actor.id,
            })

            yield* Effect.logInfo('Calling authenticated Convex workflow start mutation')

            const value = yield* Effect.tryPromise({
              try: () => {
                const client = new ConvexHttpClient(convexUrl)

                if (input.externalRef !== undefined) {
                  if (systemIngestionSecret === undefined) {
                    throw new Error(
                      'PATCHPLANE_SYSTEM_INGESTION_SECRET is required for external workflow ingestion',
                    )
                  }

                  if (input.source !== 'external') {
                    throw new Error(
                      'External workflow ingestion requires the external prompt source',
                    )
                  }

                  return client.mutation(
                    createWorkflowStartFromExternalIntakeMutation,
                    {
                      systemSecret: Redacted.value(systemIngestionSecret),
                      workspaceId: input.workspaceId,
                      actorId: input.actor.id,
                      actorDisplayName: input.actor.displayName,
                      source: input.source,
                      traceId: input.traceId,
                      prompt: input.prompt,
                      externalRef: input.externalRef,
                    },
                  )
                }

                if (input.authToken !== undefined) {
                  client.setAuth(input.authToken)
                }

                return client.mutation(createWorkflowStartMutation, {
                  workspaceId: input.workspaceId,
                  actorId: input.actor.id,
                  actorDisplayName: input.actor.displayName,
                  source: input.source,
                  traceId: input.traceId,
                  prompt: input.prompt,
                })
              },
              catch: (cause) =>
                new StorageError({
                  operation: 'createWorkflowFromPrompt',
                  message: 'Convex failed to create workflow from prompt',
                  cause,
                }),
            })

            const workflowStart = yield* decodeWorkflowStart(value).pipe(
              Effect.mapError(
                (cause) =>
                  new StorageError({
                    operation: 'createWorkflowFromPrompt.decode',
                    message: 'Convex returned an invalid workflow start',
                    cause,
                  }),
              ),
            )

            yield* Effect.logInfo('Authenticated Convex workflow start succeeded', {
              promptRequestId: workflowStart.promptRequest.id,
              workflowRunId: workflowStart.workflowRun.id,
            })

            return workflowStart
          }),
      )

      const listRecentWorkflowStarts = Effect.fn(
        '@patchplane/plugins/convex/listRecentWorkflowStarts',
      )(
        (
          input: StorageListRecentWorkflowStartsInput,
        ): Effect.Effect<ReadonlyArray<WorkflowStart>, StorageError> =>
          Effect.gen(function* () {
            yield* Effect.annotateCurrentSpan({
              workspaceId: input.workspaceId,
              limit: input.limit,
            })

            yield* Effect.logInfo('Calling Convex workflowStarts:listRecent')

            const queryArgs =
              input.limit === undefined
                ? { workspaceId: input.workspaceId }
                : { workspaceId: input.workspaceId, limit: input.limit }

            const value = yield* Effect.tryPromise({
              try: () => {
                const client = new ConvexHttpClient(convexUrl)

                if (input.authToken !== undefined) {
                  client.setAuth(input.authToken)
                }

                return client.query(listRecentWorkflowStartsQuery, queryArgs)
              },
              catch: (cause) =>
                new StorageError({
                  operation: 'listRecentWorkflowStarts',
                  message: 'Convex failed to list recent workflow starts',
                  cause,
                }),
            })

            const workflowStarts = yield* decodeWorkflowStarts(value).pipe(
              Effect.mapError(
                (cause) =>
                  new StorageError({
                    operation: 'listRecentWorkflowStarts.decode',
                    message: 'Convex returned invalid workflow starts',
                    cause,
                  }),
              ),
            )

            yield* Effect.logInfo('Convex workflowStarts:listRecent succeeded', {
              count: workflowStarts.length,
            })

            return workflowStarts
          }),
      )

      const recordSandboxExecution = Effect.fn(
        '@patchplane/plugins/convex/recordSandboxExecution',
      )(
        (input: RecordSandboxExecutionInput) =>
          Effect.gen(function* () {
            if (systemIngestionSecret === undefined) {
              return yield* new StorageError({
                operation: 'recordSandboxExecution.config',
                message:
                  'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to record sandbox executions',
                cause: undefined,
              })
            }

            const value = yield* Effect.tryPromise({
              try: () => {
                const client = new ConvexHttpClient(convexUrl)
                return client.mutation(recordSandboxExecutionMutation, {
                  systemSecret: Redacted.value(systemIngestionSecret),
                  workflowRunId: input.workflowRunId,
                  provider: input.provider,
                  sandboxId: input.sandboxId,
                  command: input.command,
                  status: input.status,
                  ...(input.exitCode === undefined ? {} : { exitCode: input.exitCode }),
                  stdout: input.stdout,
                  ...(input.stderr === undefined ? {} : { stderr: input.stderr }),
                  ...(input.policy === undefined ? {} : { policy: input.policy }),
                  startedAt: input.startedAt,
                  completedAt: input.completedAt,
                })
              },
              catch: (cause) =>
                new StorageError({
                  operation: 'recordSandboxExecution',
                  message: 'Convex failed to record sandbox execution',
                  cause,
                }),
            })

            return yield* decodeSandboxExecution(value).pipe(
              Effect.mapError(
                (cause) =>
                  new StorageError({
                    operation: 'recordSandboxExecution.decode',
                    message: 'Convex returned an invalid sandbox execution',
                    cause,
                  }),
              ),
            )
          }),
      )

      const recordRuntimeEvents = Effect.fn(
        '@patchplane/plugins/convex/recordRuntimeEvents',
      )(
        (input: ReadonlyArray<RecordRuntimeEventInput>) =>
          Effect.gen(function* () {
            if (input.length === 0) {
              return []
            }
            if (systemIngestionSecret === undefined) {
              return yield* new StorageError({
                operation: 'recordRuntimeEvents.config',
                message:
                  'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to record runtime events',
                cause: undefined,
              })
            }

            const value = yield* Effect.tryPromise({
              try: () => {
                const client = new ConvexHttpClient(convexUrl)
                return client.mutation(recordRuntimeEventsMutation, {
                  systemSecret: Redacted.value(systemIngestionSecret),
                  events: input.map((event) => ({
                    workflowRunId: event.workflowRunId,
                    provider: event.provider,
                    type: event.type,
                    occurredAt: event.occurredAt,
                    ...(event.summary === undefined ? {} : { summary: event.summary }),
                    ...(event.payloadJson === undefined
                      ? {}
                      : { payloadJson: event.payloadJson }),
                    ...(event.idempotencyKey === undefined ? {} : { idempotencyKey: event.idempotencyKey }),
                    ...(event.sourceSessionId === undefined ? {} : { sourceSessionId: event.sourceSessionId }),
                    ...(event.sourceCommandId === undefined ? {} : { sourceCommandId: event.sourceCommandId }),
                    ...(event.sourceStream === undefined ? {} : { sourceStream: event.sourceStream }),
                    ...(event.sourceLine === undefined ? {} : { sourceLine: event.sourceLine }),
                    ...(event.sourceOffset === undefined ? {} : { sourceOffset: event.sourceOffset }),
                  })),
                })
              },
              catch: (cause) =>
                new StorageError({
                  operation: 'recordRuntimeEvents',
                  message: 'Convex failed to record runtime events',
                  cause,
                }),
            })

            return yield* decodeRuntimeEvents(value).pipe(
              Effect.mapError(
                (cause) =>
                  new StorageError({
                    operation: 'recordRuntimeEvents.decode',
                    message: 'Convex returned invalid runtime events',
                    cause,
                  }),
              ),
            )
          }),
      )

      const recordRuntimeSessionStarted = Effect.fn(
        '@patchplane/plugins/convex/recordRuntimeSessionStarted',
      )((input: RecordRuntimeSessionStartedInput) =>
        Effect.gen(function* () {
          if (systemIngestionSecret === undefined) {
            return yield* new StorageError({
              operation: 'recordRuntimeSessionStarted.config',
              message: 'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to record runtime sessions',
              cause: undefined,
            })
          }
          const value = yield* Effect.tryPromise({
            try: () => {
              const client = new ConvexHttpClient(convexUrl)
              return client.mutation(recordRuntimeSessionStartedMutation, {
                systemSecret: Redacted.value(systemIngestionSecret),
                workflowRunId: input.workflowRunId,
                provider: input.provider,
                sandboxId: input.sandboxId,
                sessionId: input.sessionId,
                commandId: input.commandId,
                startedAt: input.startedAt,
              })
            },
            catch: (cause) =>
              new StorageError({
                operation: 'recordRuntimeSessionStarted',
                message: 'Convex failed to record runtime session',
                cause,
              }),
          })
          return yield* decodeRuntimeSession(value).pipe(
            Effect.mapError((cause) =>
              new StorageError({
                operation: 'recordRuntimeSessionStarted.decode',
                message: 'Convex returned invalid runtime session',
                cause,
              })
            ),
          )
        }))

      const markRuntimeSessionStatus = Effect.fn(
        '@patchplane/plugins/convex/markRuntimeSessionStatus',
      )((input: MarkRuntimeSessionStatusInput) =>
        Effect.gen(function* () {
          if (systemIngestionSecret === undefined) {
            return yield* new StorageError({
              operation: 'markRuntimeSessionStatus.config',
              message: 'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to update runtime sessions',
              cause: undefined,
            })
          }
          const value = yield* Effect.tryPromise({
            try: () => {
              const client = new ConvexHttpClient(convexUrl)
              return client.mutation(markRuntimeSessionStatusMutation, {
                systemSecret: Redacted.value(systemIngestionSecret),
                runtimeSessionId: input.runtimeSessionId,
                status: input.status,
                ...(input.completedAt === undefined ? {} : { completedAt: input.completedAt }),
              })
            },
            catch: (cause) =>
              new StorageError({
                operation: 'markRuntimeSessionStatus',
                message: 'Convex failed to update runtime session',
                cause,
              }),
          })
          return yield* decodeRuntimeSession(value).pipe(
            Effect.mapError((cause) =>
              new StorageError({
                operation: 'markRuntimeSessionStatus.decode',
                message: 'Convex returned invalid runtime session',
                cause,
              })
            ),
          )
        }))

      const getActiveRuntimeSession = Effect.fn(
        '@patchplane/plugins/convex/getActiveRuntimeSession',
      )((input: GetActiveRuntimeSessionInput) =>
        Effect.gen(function* () {
          if (systemIngestionSecret === undefined) {
            return yield* new StorageError({
              operation: 'getActiveRuntimeSession.config',
              message: 'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to read runtime sessions',
              cause: undefined,
            })
          }
          const value = yield* Effect.tryPromise({
            try: () => {
              const client = new ConvexHttpClient(convexUrl)
              return client.query(getActiveRuntimeSessionQuery, {
                systemSecret: Redacted.value(systemIngestionSecret),
                workflowRunId: input.workflowRunId,
              })
            },
            catch: (cause) =>
              new StorageError({
                operation: 'getActiveRuntimeSession',
                message: 'Convex failed to read runtime session',
                cause,
              }),
          })
          if (value === null) return undefined
          return yield* decodeRuntimeSession(value).pipe(
            Effect.mapError((cause) =>
              new StorageError({
                operation: 'getActiveRuntimeSession.decode',
                message: 'Convex returned invalid runtime session',
                cause,
              })
            ),
          )
        }))

      const recordEvidenceArtifact = Effect.fn(
        '@patchplane/plugins/convex/recordEvidenceArtifact',
      )((input: RecordEvidenceArtifactInput) =>
        Effect.gen(function* () {
          if (systemIngestionSecret === undefined) {
            return yield* new StorageError({
              operation: 'recordEvidenceArtifact.config',
              message: 'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to record evidence artifacts',
              cause: undefined,
            })
          }
          const value = yield* Effect.tryPromise({
            try: () => {
              const client = new ConvexHttpClient(convexUrl)
              return client.mutation(recordEvidenceArtifactMutation, {
                systemSecret: Redacted.value(systemIngestionSecret),
                workflowRunId: input.workflowRunId,
                ...(input.traceId === undefined ? {} : { traceId: input.traceId }),
                kind: input.kind,
                ...(input.label === undefined ? {} : { label: input.label }),
                storageProvider: input.storageProvider,
                storageKey: input.storageKey,
                contentType: input.contentType,
                sizeBytes: input.sizeBytes,
                sha256: input.sha256,
                ...(input.retentionPolicy === undefined ? {} : { retentionPolicy: input.retentionPolicy }),
                ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
              })
            },
            catch: (cause) =>
              new StorageError({
                operation: 'recordEvidenceArtifact',
                message: 'Convex failed to record evidence artifact',
                cause,
              }),
          })
          return yield* decodeEvidenceArtifact(value).pipe(
            Effect.mapError((cause) =>
              new StorageError({
                operation: 'recordEvidenceArtifact.decode',
                message: 'Convex returned invalid evidence artifact',
                cause,
              })
            ),
          )
        }))

      const getEvidenceArtifact = Effect.fn(
        '@patchplane/plugins/convex/getEvidenceArtifact',
      )((input: GetEvidenceArtifactInput) =>
        Effect.gen(function* () {
          if (input.authToken === undefined && systemIngestionSecret === undefined) {
            return yield* new StorageError({
              operation: 'getEvidenceArtifact.config',
              message: 'authToken or PATCHPLANE_SYSTEM_INGESTION_SECRET is required to read evidence artifacts',
              cause: undefined,
            })
          }
          const value = yield* Effect.tryPromise({
            try: () => {
              const client = new ConvexHttpClient(convexUrl)
              if (input.authToken !== undefined) {
                client.setAuth(input.authToken)
              }
              return client.query(getEvidenceArtifactQuery, {
                artifactId: input.artifactId,
                ...(input.workflowRunId === undefined ? {} : { workflowRunId: input.workflowRunId }),
                ...(input.authToken !== undefined || systemIngestionSecret === undefined
                  ? {}
                  : { systemSecret: Redacted.value(systemIngestionSecret) }),
              })
            },
            catch: (cause) =>
              new StorageError({
                operation: 'getEvidenceArtifact',
                message: 'Convex failed to read evidence artifact',
                cause,
              }),
          })
          if (value === null) return undefined
          return yield* decodeEvidenceArtifact(value).pipe(
            Effect.mapError((cause) =>
              new StorageError({
                operation: 'getEvidenceArtifact.decode',
                message: 'Convex returned invalid evidence artifact',
                cause,
              })
            ),
          )
        }))

      const recordCandidatePatchSet = Effect.fn(
        '@patchplane/plugins/convex/recordCandidatePatchSet',
      )((input: RecordCandidatePatchSetInput) =>
        Effect.gen(function* () {
          if (systemIngestionSecret === undefined) {
            return yield* new StorageError({
              operation: 'recordCandidatePatchSet.config',
              message: 'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to record candidate patch sets',
              cause: undefined,
            })
          }
          const value = yield* Effect.tryPromise({
            try: () => {
              const client = new ConvexHttpClient(convexUrl)
              return client.mutation(recordCandidatePatchSetMutation, {
                systemSecret: Redacted.value(systemIngestionSecret),
                workflowRunId: input.workflowRunId,
                status: input.status,
                ...(input.baseRef === undefined ? {} : { baseRef: input.baseRef }),
                ...(input.baseSha === undefined ? {} : { baseSha: input.baseSha }),
                ...(input.headRef === undefined ? {} : { headRef: input.headRef }),
                ...(input.headSha === undefined ? {} : { headSha: input.headSha }),
                ...(input.diffArtifactId === undefined ? {} : { diffArtifactId: input.diffArtifactId }),
                ...(input.summary === undefined ? {} : { summary: input.summary }),
                ...(input.stats === undefined ? {} : { stats: input.stats }),
                ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
              })
            },
            catch: (cause) =>
              new StorageError({
                operation: 'recordCandidatePatchSet',
                message: 'Convex failed to record candidate patch set',
                cause,
              }),
          })
          return yield* decodeCandidatePatchSet(value).pipe(
            Effect.mapError((cause) =>
              new StorageError({
                operation: 'recordCandidatePatchSet.decode',
                message: 'Convex returned invalid candidate patch set',
                cause,
              })
            ),
          )
        }))

      const recordReviewRun = Effect.fn(
        '@patchplane/plugins/convex/recordReviewRun',
      )((input: RecordReviewRunInput) =>
        Effect.gen(function* () {
          if (systemIngestionSecret === undefined) {
            return yield* new StorageError({
              operation: 'recordReviewRun.config',
              message: 'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to record review runs',
              cause: undefined,
            })
          }
          const value = yield* Effect.tryPromise({
            try: () => {
              const client = new ConvexHttpClient(convexUrl)
              return client.mutation(recordReviewRunMutation, {
                systemSecret: Redacted.value(systemIngestionSecret),
                workflowRunId: input.workflowRunId,
                ...(input.sandboxExecutionId === undefined ? {} : { sandboxExecutionId: input.sandboxExecutionId }),
                ...(input.candidatePatchSetId === undefined ? {} : { candidatePatchSetId: input.candidatePatchSetId }),
                kind: input.kind,
                reviewer: input.reviewer,
                status: input.status,
                ...(input.summary === undefined ? {} : { summary: input.summary }),
                startedAt: input.startedAt,
                ...(input.completedAt === undefined ? {} : { completedAt: input.completedAt }),
                ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
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
            Effect.mapError((cause) =>
              new StorageError({
                operation: 'recordReviewRun.decode',
                message: 'Convex returned invalid review run',
                cause,
              })
            ),
          )
        }))

      const recordReviewFinding = Effect.fn(
        '@patchplane/plugins/convex/recordReviewFinding',
      )((input: RecordReviewFindingInput) =>
        Effect.gen(function* () {
          if (systemIngestionSecret === undefined) {
            return yield* new StorageError({
              operation: 'recordReviewFinding.config',
              message: 'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to record review findings',
              cause: undefined,
            })
          }
          const value = yield* Effect.tryPromise({
            try: () => {
              const client = new ConvexHttpClient(convexUrl)
              return client.mutation(recordReviewFindingMutation, {
                systemSecret: Redacted.value(systemIngestionSecret),
                workflowRunId: input.workflowRunId,
                ...(input.reviewRunId === undefined ? {} : { reviewRunId: input.reviewRunId }),
                severity: input.severity,
                category: input.category,
                message: input.message,
                ...(input.path === undefined ? {} : { path: input.path }),
                ...(input.startLine === undefined ? {} : { startLine: input.startLine }),
                ...(input.endLine === undefined ? {} : { endLine: input.endLine }),
                ...(input.evidenceArtifactId === undefined ? {} : { evidenceArtifactId: input.evidenceArtifactId }),
                ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
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
            Effect.mapError((cause) =>
              new StorageError({
                operation: 'recordReviewFinding.decode',
                message: 'Convex returned invalid review finding',
                cause,
              })
            ),
          )
        }))

      const recordPolicyDecision = Effect.fn(
        '@patchplane/plugins/convex/recordPolicyDecision',
      )((input: RecordPolicyDecisionInput) =>
        Effect.gen(function* () {
          if (systemIngestionSecret === undefined) {
            return yield* new StorageError({
              operation: 'recordPolicyDecision.config',
              message: 'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to record policy decisions',
              cause: undefined,
            })
          }
          const value = yield* Effect.tryPromise({
            try: () => {
              const client = new ConvexHttpClient(convexUrl)
              return client.mutation(recordPolicyDecisionMutation, {
                systemSecret: Redacted.value(systemIngestionSecret),
                workflowRunId: input.workflowRunId,
                ...(input.reviewRunId === undefined ? {} : { reviewRunId: input.reviewRunId }),
                status: input.status,
                summary: input.summary,
                ...(input.reason === undefined ? {} : { reason: input.reason }),
                ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
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
            Effect.mapError((cause) =>
              new StorageError({
                operation: 'recordPolicyDecision.decode',
                message: 'Convex returned invalid policy decision',
                cause,
              })
            ),
          )
        }))

      const recordPublicationResult = Effect.fn(
        '@patchplane/plugins/convex/recordPublicationResult',
      )((input: RecordPublicationResultInput) =>
        Effect.gen(function* () {
          if (systemIngestionSecret === undefined) {
            return yield* new StorageError({
              operation: 'recordPublicationResult.config',
              message: 'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to record publication results',
              cause: undefined,
            })
          }
          const value = yield* Effect.tryPromise({
            try: () => {
              const client = new ConvexHttpClient(convexUrl)
              return client.mutation(recordPublicationResultMutation, {
                systemSecret: Redacted.value(systemIngestionSecret),
                workflowRunId: input.workflowRunId,
                provider: input.provider,
                kind: input.kind,
                status: input.status,
                ...(input.externalId === undefined ? {} : { externalId: input.externalId }),
                ...(input.url === undefined ? {} : { url: input.url }),
                ...(input.summary === undefined ? {} : { summary: input.summary }),
                ...(input.error === undefined ? {} : { error: input.error }),
                ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
                ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
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
            Effect.mapError((cause) =>
              new StorageError({
                operation: 'recordPublicationResult.decode',
                message: 'Convex returned invalid publication result',
                cause,
              })
            ),
          )
        }))

      const recordProvenanceEvent = Effect.fn(
        '@patchplane/plugins/convex/recordProvenanceEvent',
      )((input: RecordProvenanceEventInput) =>
        Effect.gen(function* () {
          if (systemIngestionSecret === undefined) {
            return yield* new StorageError({
              operation: 'recordProvenanceEvent.config',
              message: 'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to record provenance events',
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
                ...(input.parentEventId === undefined ? {} : { parentEventId: input.parentEventId }),
                type: input.type,
                operation: input.operation,
                ...(input.pluginName === undefined ? {} : { pluginName: input.pluginName }),
                status: input.status,
                startedAt: input.startedAt,
                ...(input.completedAt === undefined ? {} : { completedAt: input.completedAt }),
                ...(input.summary === undefined ? {} : { summary: input.summary }),
                artifactRefs: input.artifactRefs ?? [],
                ...(input.errorCategory === undefined ? {} : { errorCategory: input.errorCategory }),
                ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
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
            Effect.mapError((cause) =>
              new StorageError({
                operation: 'recordProvenanceEvent.decode',
                message: 'Convex returned invalid provenance event',
                cause,
              })
            ),
          )
        }))

      return StorageService.of({
        createWorkflowFromIntake: createWorkflowFromPrompt,
        createWorkflowFromPrompt,
        listRecentWorkflowStarts,
        recordRuntimeEvents,
        recordRuntimeSessionStarted,
        markRuntimeSessionStatus,
        getActiveRuntimeSession,
        recordSandboxExecution,
        recordEvidenceArtifact,
        getEvidenceArtifact,
        recordCandidatePatchSet,
        recordReviewRun,
        recordReviewFinding,
        recordPolicyDecision,
        recordPublicationResult,
        recordProvenanceEvent,
      })
    }),
  ),
  config: ConvexConfig,
} satisfies {
  readonly layer: Layer.Layer<StorageService, Config.ConfigError>
  readonly config: typeof ConvexConfig
}
