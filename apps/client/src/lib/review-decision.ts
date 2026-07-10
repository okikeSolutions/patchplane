import * as Cloudflare from 'alchemy/Cloudflare/Bridge'
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { Effect, Schema } from 'effect'
import * as HttpBody from 'effect/unstable/http/HttpBody'
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest'
import { publicErrorMessage } from '@patchplane/domain/errors'
import { getSourceControlWorker } from '@/env'
import { effectServerFn } from './effect-server-fn'
import { getWorkOSAuthRequest } from './workos-auth-request'

const ReviewDecisionInput = Schema.Struct({
  workflowRunId: Schema.String,
  status: Schema.Literals(['approved', 'rejected', 'changes-requested']),
  comment: Schema.String,
  idempotencyKey: Schema.String,
})

const recordHumanDecisionMutation = makeFunctionReference<
  'mutation',
  {
    workflowRunId: string
    status: typeof ReviewDecisionInput.Type.status
    comment: string
    idempotencyKey?: string
  },
  {
    id: string
    workflowRunId: string
    actorId: string
    status: typeof ReviewDecisionInput.Type.status
    comment: string
    decidedAt: number
    idempotencyKey?: string
  }
>('workflowStarts:recordHumanDecision')

const getDetailQuery = makeFunctionReference<
  'query',
  { workflowRunId: string },
  WorkflowDetailForPublication
>('workflowStarts:getDetail')

const SourceControlPublishDecisionResponse = Schema.Struct({
  ok: Schema.Boolean,
  traceId: Schema.String,
  error: Schema.optional(Schema.String),
  publications: Schema.optional(Schema.Array(Schema.Unknown)),
})

type SourceControlPublishDecisionResponse = Schema.Schema.Type<typeof SourceControlPublishDecisionResponse>

interface WorkflowDetailForPublication {
  readonly promptRequest: Record<string, unknown>
  readonly workflowRun: { readonly id: string; readonly traceId: string; readonly promptRequestId: string; readonly workspaceId: string; readonly status: string; readonly createdAt: number }
  readonly sandboxExecutions: ReadonlyArray<Record<string, unknown> & { readonly startedAt?: number }>
  readonly candidatePatchSets: ReadonlyArray<Record<string, unknown> & { readonly createdAt?: number }>
  readonly humanDecisions: ReadonlyArray<Record<string, unknown> & { readonly id: string; readonly decidedAt?: number }>
  readonly publicationResults: ReadonlyArray<Record<string, unknown>>
}

function configuredConvexUrl() {
  const value = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL
  if (value === undefined || value.trim().length === 0) {
    throw new Error('CONVEX_URL or VITE_CONVEX_URL is required')
  }
  return value.replace(/\/$/, '')
}

function latestBy<A>(items: ReadonlyArray<A>, value: (item: A) => number | undefined) {
  return items.reduce<A | undefined>((latest, item) => {
    const itemValue = value(item) ?? Number.NEGATIVE_INFINITY
    const latestValue = latest === undefined ? Number.NEGATIVE_INFINITY : value(latest) ?? Number.NEGATIVE_INFINITY
    return itemValue > latestValue ? item : latest
  }, undefined)
}

async function publishDecisionToSourceControl(input: {
  readonly traceId: string
  readonly detail: WorkflowDetailForPublication
  readonly humanDecision: Record<string, unknown>
}) {
  const client = Cloudflare.toHttpClient(
    Cloudflare.fromCloudflareFetcher(await getSourceControlWorker()),
  )
  const { patchPlaneRuntime } = await import('@/effect/runtime')
  const workflowStart = {
    promptRequest: input.detail.promptRequest,
    workflowRun: input.detail.workflowRun,
  }
  return await patchPlaneRuntime.runPromise(
    client.execute(
      HttpClientRequest.post('https://source-control-worker/internal/decision/publish', {
        headers: {
          'content-type': 'application/json',
        },
        body: HttpBody.text(JSON.stringify({
          traceId: input.traceId,
          workflowStart,
          humanDecision: input.humanDecision,
          sandboxExecution: latestBy(input.detail.sandboxExecutions, (execution) => execution.startedAt),
          candidatePatchSet: latestBy(input.detail.candidatePatchSets, (patchSet) => patchSet.createdAt),
          publicationResults: input.detail.publicationResults,
        }), 'application/json'),
      }),
    ).pipe(
      Effect.flatMap((workerResponse) => workerResponse.json),
      Effect.flatMap(Schema.decodeUnknownEffect(SourceControlPublishDecisionResponse)),
    ),
  )
}

export const submitReviewDecisionServerFn = effectServerFn({
  method: 'POST',
  input: ReviewDecisionInput,
  operation: 'submitReviewDecisionServerFn',
  effect: (input, context) =>
    Effect.promise(async () => {
      const comment = input.comment.trim()
      if (comment.length === 0) {
        throw new Error('Decision comment required')
      }

      const authRequest = await getWorkOSAuthRequest()
      const convex = new ConvexHttpClient(configuredConvexUrl())
      if (authRequest.accessToken !== undefined) {
        convex.setAuth(authRequest.accessToken)
      }

      const decision = await convex.mutation(recordHumanDecisionMutation, {
        workflowRunId: input.workflowRunId,
        status: input.status,
        comment,
        idempotencyKey: input.idempotencyKey,
      })
      const detail = await convex.query(getDetailQuery, { workflowRunId: input.workflowRunId })
      const response = await publishDecisionToSourceControl({
        traceId: context.traceId,
        detail,
        humanDecision: decision,
      })

      if (!response.ok) {
        throw new Error(response.error ?? 'Decision publication failed')
      }

      return { decision, publications: response.publications ?? [] }
    }),
  success: (result: {
    readonly decision: {
      readonly id: string
      readonly status: typeof ReviewDecisionInput.Type.status
    }
    readonly publications: ReadonlyArray<unknown>
  }) => result,
  failure: (cause: unknown) => ({
    error: publicErrorMessage(cause, 'Review decision failed'),
  }),
})
