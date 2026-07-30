import { ConvexHttpClient } from 'convex/browser'
import { Effect } from 'effect'
import { captureCloudflareRequestFailure } from '@patchplane/plugins/sentry/cloudflare-worker'
import {
  type Env,
  boundaryError,
  releaseDeliveryProcessingMutation,
} from './boundary'

export const reportFailure = (
  operation: Parameters<typeof captureCloudflareRequestFailure>[0],
) => Effect.sync(() => captureCloudflareRequestFailure(operation))

export const promiseCall = <A>(operation: string, call: () => Promise<A>) =>
  Effect.tryPromise({
    try: call,
    catch: (cause) => boundaryError(operation, cause),
  })

export const releaseProcessing = (
  env: Env,
  input: {
    readonly deliveryId: string
    readonly deliveryToken: string
    readonly processingToken: string
  },
) =>
  promiseCall('convex.releaseDeliveryProcessing', () =>
    new ConvexHttpClient(env.CONVEX_URL).mutation(
      releaseDeliveryProcessingMutation,
      {
        systemSecret: env.PATCHPLANE_SYSTEM_INGESTION_SECRET,
        ...input,
      },
    ),
  )
