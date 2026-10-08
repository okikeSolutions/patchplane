import type { FunctionArgs, FunctionReference } from 'convex/server'
import { Effect } from 'effect'
import {
  convexMutation,
  convexQuery,
} from '@patchplane/plugins/convex/http-client'
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

export const convexMutationCall = <
  Reference extends FunctionReference<'mutation'>,
>(
  env: Env,
  operation: string,
  reference: Reference,
  args: FunctionArgs<Reference>,
) =>
  convexMutation({
    url: env.CONVEX_URL,
    reference,
    args,
    catch: (cause) => boundaryError(operation, cause),
  })

export const convexQueryCall = <Reference extends FunctionReference<'query'>>(
  env: Env,
  operation: string,
  reference: Reference,
  args: FunctionArgs<Reference>,
) =>
  convexQuery({
    url: env.CONVEX_URL,
    reference,
    args,
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
  convexMutationCall(
    env,
    'convex.releaseDeliveryProcessing',
    releaseDeliveryProcessingMutation,
    {
      systemSecret: env.PATCHPLANE_SYSTEM_INGESTION_SECRET,
      ...input,
    },
  )
