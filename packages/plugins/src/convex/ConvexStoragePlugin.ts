import { Config, Effect, Layer, Redacted } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/unstable/http'
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { StorageError } from '@patchplane/domain/errors'
import {
  decodeWorkflowStart,
  decodeWorkflowStarts,
  type WorkflowStart,
} from '@patchplane/domain/workflow-start'
import {
  StorageService,
  type CreateWorkflowFromPromptInput,
  type StorageListRecentWorkflowStartsInput,
} from '@patchplane/core/services/storage-service'
import { ConvexConfig } from './ConvexConfig'

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

function normalizeConvexSiteUrl(url: { toString(): string }) {
  return normalizeConvexUrl(url).replace('.convex.cloud', '.convex.site')
}

export const ConvexStoragePlugin = {
  layer: Layer.effect(
    StorageService,
    Effect.gen(function* () {
      const config = yield* ConvexConfig
      const convexUrl = normalizeConvexUrl(config.url)
      const convexSiteUrl = normalizeConvexSiteUrl(config.url)
      const trustedWriteSecret = Redacted.value(config.trustedWriteSecret)
      const httpClient = yield* HttpClient.HttpClient

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

            yield* Effect.logInfo('Calling trusted Convex workflow start endpoint')

            const value = yield* HttpClientRequest.post(
              `${convexSiteUrl}/workflow-starts/create`,
            ).pipe(
              HttpClientRequest.setHeaders({
                'x-patchplane-convex-write-secret': trustedWriteSecret,
              }),
              HttpClientRequest.bodyJsonUnsafe({
                workspaceId: input.workspaceId,
                actorId: input.actor.id,
                actorDisplayName: input.actor.displayName,
                source: input.source,
                traceId: input.traceId,
                prompt: input.prompt,
              }),
              httpClient.execute,
              Effect.flatMap(HttpClientResponse.filterStatusOk),
              Effect.flatMap((response) => response.json),
              Effect.mapError(
                (cause) =>
                  new StorageError({
                    operation: 'createWorkflowFromPrompt',
                    message: 'Convex failed to create workflow from prompt',
                    cause,
                  }),
              ),
            )

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

            yield* Effect.logInfo('Trusted Convex workflow start succeeded', {
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

      return StorageService.of({
        createWorkflowFromPrompt,
        listRecentWorkflowStarts,
      })
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer)),
  config: ConvexConfig,
} satisfies {
  readonly layer: Layer.Layer<StorageService, Config.ConfigError>
  readonly config: typeof ConvexConfig
}
