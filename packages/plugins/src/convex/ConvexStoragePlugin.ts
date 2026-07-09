import { Config, Effect, Layer, Option, Redacted } from 'effect'
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
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
      })
    }),
  ),
  config: ConvexConfig,
} satisfies {
  readonly layer: Layer.Layer<StorageService, Config.ConfigError>
  readonly config: typeof ConvexConfig
}
