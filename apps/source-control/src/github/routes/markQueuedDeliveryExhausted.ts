import { convexMutation } from '@patchplane/plugins/convex/http-client'
import { Effect, Exit, Schema } from 'effect'
import { loadSourceControlRouteConfig, type WorkerEnv } from '../config'
import {
  readBoundedJson,
  SourceControlWorkerRequestError,
  terminalizeQueuedGitHubDeliveryMutation,
  jsonResponse,
  configuredConvexUrl,
  systemIngestionSecret,
} from './support'

const convexOperationTimeoutMilliseconds = 15_000

export const queuedDeliveryExhaustedRequestSchema = Schema.Struct({
  deliveryId: Schema.NonEmptyString.check(Schema.isMaxLength(128)),
  deliveryToken: Schema.NonEmptyString.check(Schema.isMaxLength(128)),
  processingToken: Schema.NonEmptyString.check(Schema.isMaxLength(128)),
})

const queuedDeliveryTerminalStateSchema = Schema.Struct({
  terminalized: Schema.Boolean,
  workflowRunId: Schema.optional(
    Schema.NonEmptyString.check(Schema.isMaxLength(256)),
  ),
})

export const markQueuedDeliveryExhausted = Effect.fnUntraced(function* (
  request: Request,
  env: WorkerEnv,
) {
  const inputExit = yield* readBoundedJson(request).pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(queuedDeliveryExhaustedRequestSchema),
    ),
    Effect.exit,
  )
  if (Exit.isFailure(inputExit)) {
    return jsonResponse(
      { ok: false, error: 'Invalid delivery identity' },
      { status: 400 },
    )
  }

  const configExit = yield* loadSourceControlRouteConfig(env).pipe(Effect.exit)
  if (Exit.isFailure(configExit)) {
    return jsonResponse(
      { ok: false, error: 'Source-control configuration is invalid' },
      { status: 500 },
    )
  }
  const secret = systemIngestionSecret(configExit.value)
  if (secret === undefined) {
    return jsonResponse(
      { ok: false, error: 'System ingestion is not configured' },
      { status: 500 },
    )
  }

  const input = inputExit.value
  const terminal = yield* convexMutation({
    url: configuredConvexUrl(configExit.value),
    reference: terminalizeQueuedGitHubDeliveryMutation,
    args: {
      systemSecret: secret,
      deliveryId: input.deliveryId,
      deliveryToken: input.deliveryToken,
      processingToken: input.processingToken,
    },
    catch: (cause) =>
      new SourceControlWorkerRequestError({
        message: 'Unable to terminalize exhausted queued delivery',
        cause,
      }),
  }).pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(queuedDeliveryTerminalStateSchema),
    ),
    Effect.mapError(
      (cause) =>
        new SourceControlWorkerRequestError({
          message: 'Invalid exhausted queued-delivery terminal state',
          cause,
        }),
    ),
    Effect.timeoutOrElse({
      duration: convexOperationTimeoutMilliseconds,
      orElse: () =>
        Effect.fail(
          new SourceControlWorkerRequestError({
            message: 'Exhausted queued-delivery terminalization timed out',
          }),
        ),
    }),
  )

  return jsonResponse({ ok: true, ...terminal }, { status: 200 })
})
