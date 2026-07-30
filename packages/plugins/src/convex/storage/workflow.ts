import { Effect, Redacted, Schema } from 'effect'
import { ConvexHttpClient } from 'convex/browser'
import { StorageError } from '@patchplane/domain/errors'
import {
  decodeWorkflowStart,
  decodeWorkflowStarts,
} from '@patchplane/domain/workflow-start'
import {
  type ClaimWorkflowExecutionInput,
  type MarkWorkflowExecutionFailedInput,
  type CreateWorkflowFromPromptInput,
  type StorageListRecentWorkflowStartsInput,
} from '@patchplane/core/services/storage-service'
import {
  createWorkflowStartMutation,
  createWorkflowStartFromExternalIntakeMutation,
  claimWorkflowExecutionMutation,
  markWorkflowExecutionFailedMutation,
  listRecentWorkflowStartsQuery,
} from './shared'

export interface ConvexStorageContext {
  readonly convexUrl: string
  readonly systemIngestionSecret:
    | import('effect').Redacted.Redacted<string>
    | undefined
}

export function makeWorkflowStorageOperations(context: ConvexStorageContext) {
  const { convexUrl, systemIngestionSecret } = context

  const createWorkflowFromPrompt = Effect.fn(
    '@patchplane/plugins/convex/createWorkflowFromPrompt',
  )(function* (input: CreateWorkflowFromPromptInput) {
    yield* Effect.annotateCurrentSpan({
      traceId: input.traceId,
      workspaceId: input.workspaceId,
      actorId: input.actor.id,
    })

    yield* Effect.logInfo(
      'Calling authenticated Convex workflow start mutation',
    )

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
  })

  const listRecentWorkflowStarts = Effect.fn(
    '@patchplane/plugins/convex/listRecentWorkflowStarts',
  )(function* (input: StorageListRecentWorkflowStartsInput) {
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
  })

  const claimWorkflowExecution = Effect.fn(
    '@patchplane/plugins/convex/claimWorkflowExecution',
  )(function* (input: ClaimWorkflowExecutionInput) {
    if (systemIngestionSecret === undefined) {
      return yield* new StorageError({
        operation: 'claimWorkflowExecution.config',
        message:
          'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to claim workflow execution',
        cause: undefined,
      })
    }
    const result = yield* Effect.tryPromise({
      try: () =>
        new ConvexHttpClient(convexUrl).mutation(
          claimWorkflowExecutionMutation,
          {
            systemSecret: Redacted.value(systemIngestionSecret),
            workflowRunId: input.workflowRunId,
          },
        ),
      catch: (cause) =>
        new StorageError({
          operation: 'claimWorkflowExecution',
          message: 'Convex failed to claim workflow execution',
          cause,
        }),
    })
    return yield* Schema.decodeUnknownEffect(Schema.Boolean)(result).pipe(
      Effect.mapError(
        (cause) =>
          new StorageError({
            operation: 'claimWorkflowExecution.decode',
            message:
              'Convex returned an invalid workflow execution claim result',
            cause,
          }),
      ),
    )
  })

  const markWorkflowExecutionFailed = Effect.fn(
    '@patchplane/plugins/convex/markWorkflowExecutionFailed',
  )(function* (input: MarkWorkflowExecutionFailedInput) {
    if (systemIngestionSecret === undefined) {
      return yield* new StorageError({
        operation: 'markWorkflowExecutionFailed.config',
        message:
          'PATCHPLANE_SYSTEM_INGESTION_SECRET is required to mark workflow execution failed',
        cause: undefined,
      })
    }
    const result = yield* Effect.tryPromise({
      try: () =>
        new ConvexHttpClient(convexUrl).mutation(
          markWorkflowExecutionFailedMutation,
          {
            systemSecret: Redacted.value(systemIngestionSecret),
            workflowRunId: input.workflowRunId,
            ...(input.incomingDispatchToken === undefined
              ? {}
              : { incomingDispatchToken: input.incomingDispatchToken }),
            summary: input.summary,
          },
        ),
      catch: (cause) =>
        new StorageError({
          operation: 'markWorkflowExecutionFailed',
          message: 'Convex failed to mark workflow execution failed',
          cause,
        }),
    })
    return yield* Schema.decodeUnknownEffect(Schema.Boolean)(result).pipe(
      Effect.mapError(
        (cause) =>
          new StorageError({
            operation: 'markWorkflowExecutionFailed.decode',
            message:
              'Convex returned an invalid workflow execution failure result',
            cause,
          }),
      ),
    )
  })

  return {
    createWorkflowFromPrompt,
    listRecentWorkflowStarts,
    claimWorkflowExecution,
    markWorkflowExecutionFailed,
  }
}
