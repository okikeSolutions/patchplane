import { Effect } from 'effect'
import { TelemetryService } from '@patchplane/core/services/telemetry-service'
import { CloudflareTelemetryPlugin } from '@patchplane/plugins/sentry/cloudflare-telemetry-plugin'
import { withCloudflareSentry } from '@patchplane/plugins/sentry/cloudflare-worker'
import { type Env, type QueueBatch } from './webhook-worker/boundary'
import { processDeadLetterMessage } from './webhook-worker/deadLetter'
import { handleFetch } from './webhook-worker/fetch'
import { processPrimaryMessage } from './webhook-worker/primary'
import { reportFailure } from './webhook-worker/processingSupport'
import { handleScheduled } from './webhook-worker/scheduled'

const handleQueue = Effect.fnUntraced(function* (
  batch: QueueBatch<unknown>,
  env: Env,
) {
  for (const message of batch.messages) {
    if (batch.queue === env.VERIFICATION_DEAD_LETTER_QUEUE_NAME) {
      yield* processDeadLetterMessage(message, env)
    } else {
      yield* processPrimaryMessage(message, env)
    }
  }
})

function runObservedWorkerEffect<A, E>(
  name: string,
  effect: Effect.Effect<A, E>,
  signal?: AbortSignal,
) {
  return Effect.runPromise(
    TelemetryService.pipe(
      Effect.flatMap((telemetry) =>
        telemetry.withSpan({ name, operation: name }, effect),
      ),
      Effect.provide(CloudflareTelemetryPlugin.layer),
    ),
    signal === undefined ? undefined : { signal },
  )
}

const handler = {
  fetch(request: Request, env: Env) {
    return runObservedWorkerEffect(
      'source-control.webhook.fetch',
      handleFetch(request, env),
      request.signal,
    )
  },
  scheduled(_controller: unknown, env: Env) {
    return runObservedWorkerEffect(
      'source-control.webhook.scheduled',
      handleScheduled(env).pipe(
        Effect.catchCause(() =>
          reportFailure('github-webhook-worker.queue.send'),
        ),
      ),
    )
  },
  queue(batch: QueueBatch<unknown>, env: Env) {
    return runObservedWorkerEffect(
      'source-control.webhook.queue',
      handleQueue(batch, env),
    )
  },
}

export default withCloudflareSentry({ ...handler })
