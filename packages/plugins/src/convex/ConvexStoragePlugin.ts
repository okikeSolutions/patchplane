import { Config, Effect, Layer } from 'effect'
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { StorageError } from '@patchplane/domain/errors'
import type { PromptRequestSource } from '@patchplane/domain/prompt-request'
import {
  decodeWorkflowStart,
  decodeWorkflowStarts,
  type WorkflowStart,
} from '@patchplane/domain/workflow-start'
import {
  StorageService,
  type CreateWorkflowFromPromptInput,
  type ListRecentWorkflowStartsInput,
} from '@patchplane/core/services/storage-service'
import { ConvexConfig } from './ConvexConfig'

const createWorkflowFromPromptMutation = makeFunctionReference<
  'mutation',
  {
    workspaceId: string
    actorId: string
    actorDisplayName: string
    source: PromptRequestSource
    traceId: string
    prompt: string
  },
  unknown
>('workflowStarts:create')

const listRecentWorkflowStartsQuery = makeFunctionReference<
  'query',
  {
    workspaceId: string
    limit?: number
  },
  unknown
>('workflowStarts:listRecent')

function normalizeConvexUrl(url: { toString(): string }) {
  return url.toString().replace(/\/$/, '')
}

export const ConvexStoragePlugin = {
  layer: Layer.effect(
    StorageService,
    Effect.gen(function* () {
      const config = yield* ConvexConfig
      const client = new ConvexHttpClient(normalizeConvexUrl(config.url))

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

            yield* Effect.logInfo('Calling Convex workflowStarts:create')

            const value = yield* Effect.tryPromise({
              try: () =>
                client.mutation(createWorkflowFromPromptMutation, {
                  workspaceId: input.workspaceId,
                  actorId: input.actor.id,
                  actorDisplayName: input.actor.displayName,
                  source: input.source,
                  traceId: input.traceId,
                  prompt: input.prompt,
                }),
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

            yield* Effect.logInfo('Convex workflowStarts:create succeeded', {
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
          input: ListRecentWorkflowStartsInput,
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
              try: () => client.query(listRecentWorkflowStartsQuery, queryArgs),
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

      return StorageService.of({
        createWorkflowFromPrompt,
        listRecentWorkflowStarts,
      })
    }),
  ),
  config: ConvexConfig,
} satisfies {
  readonly layer: Layer.Layer<StorageService, Config.ConfigError>
  readonly config: typeof ConvexConfig
}
