import { Config, Effect, Layer, Option, Redacted } from 'effect'
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { StorageError } from '@patchplane/domain/errors'
import { decodeRuntimeEvents } from '@patchplane/domain/runtime-event'
import { decodeSandboxExecution } from '@patchplane/domain/sandbox-execution'
import { decodeSandboxPolicy } from '@patchplane/domain/sandbox-policy'
import {
  decodeWorkflowStart,
  decodeWorkflowStarts,
  type WorkflowStart,
} from '@patchplane/domain/workflow-start'
import {
  StorageService,
  type CreateWorkflowFromPromptInput,
  type RecordRuntimeEventInput,
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
    }>
  },
  unknown
>('workflowStarts:recordRuntimeEvents')

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
    policyJson?: string
    startedAt: number
    completedAt: number
  },
  unknown
>('workflowStarts:recordSandboxExecution')

const listRecentWorkflowStartsQuery = makeFunctionReference<
  'query',
  {
    workspaceId: string
    limit?: number
  },
  unknown
>('workflowStarts:listRecent')

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function sandboxExecutionWithDecodedPolicy(value: unknown) {
  return Effect.gen(function* () {
    if (!isObjectRecord(value) || typeof value.policyJson !== 'string') {
      return value
    }

    const rawPolicyJson = value.policyJson
    const policyJson = yield* Effect.try({
      try: () => JSON.parse(rawPolicyJson) as unknown,
      catch: (cause) =>
        new StorageError({
          operation: 'recordSandboxExecution.decodePolicyJson',
          message: 'Convex returned malformed sandbox policy JSON',
          cause,
        }),
    })
    const policy = yield* decodeSandboxPolicy(policyJson)
    const { policyJson: _policyJson, ...rest } = value
    return { ...rest, policy }
  })
}

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
                  ...(input.policy === undefined ? {} : { policyJson: JSON.stringify(input.policy) }),
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

            const decodedValue = yield* sandboxExecutionWithDecodedPolicy(value).pipe(
              Effect.mapError(
                (cause) =>
                  new StorageError({
                    operation: 'recordSandboxExecution.decodePolicy',
                    message: 'Convex returned an invalid sandbox policy',
                    cause,
                  }),
              ),
            )

            return yield* decodeSandboxExecution(decodedValue).pipe(
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

      return StorageService.of({
        createWorkflowFromIntake: createWorkflowFromPrompt,
        createWorkflowFromPrompt,
        listRecentWorkflowStarts,
        recordRuntimeEvents,
        recordSandboxExecution,
      })
    }),
  ),
  config: ConvexConfig,
} satisfies {
  readonly layer: Layer.Layer<StorageService, Config.ConfigError>
  readonly config: typeof ConvexConfig
}
