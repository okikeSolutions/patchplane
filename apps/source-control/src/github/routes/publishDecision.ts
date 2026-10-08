import { convexQuery } from '@patchplane/plugins/convex/http-client'
import { Effect, Exit, Schema } from 'effect'
import { loadSourceControlRouteConfig, type WorkerEnv } from '../config'
import { AssemblePatchReportV1 } from '@patchplane/core/patch-report/assemble-patch-report-v1'
import { PublishDecisionToSource } from '@patchplane/core/workflows/publish-decision-to-source'
import { withTelemetrySpan } from '@patchplane/core/services/telemetry-service'
import { HumanDecisionId, WorkflowRunId } from '@patchplane/domain/ids'
import { withCapturedCriticalPathScope } from '../../critical-path-telemetry'
import {
  SourceControlWorkerRequestError,
  publishDecisionRequestSchema,
  decisionPublicationFixtureSchema,
  getDecisionPublicationFixtureQuery,
  jsonResponse,
  nestedString,
  configuredConvexUrl,
  systemIngestionSecret,
  randomTraceIdEffect,
  readBoundedJson,
} from './support'

const convexOperationTimeoutMilliseconds = 15_000

function decodePublicationIdentity(input: {
  readonly workflowRunId?: string | undefined
  readonly humanDecisionId?: string | undefined
  readonly workflowStart?: unknown
  readonly humanDecision?: unknown
}) {
  return Effect.all({
    workflowRunId: Schema.decodeUnknownEffect(WorkflowRunId)(
      input.workflowRunId ??
        nestedString(input.workflowStart, 'workflowRun', 'id'),
    ),
    humanDecisionId: Schema.decodeUnknownEffect(HumanDecisionId)(
      input.humanDecisionId ?? nestedString(input.humanDecision, 'id'),
    ),
  })
}

function publicPublications(
  publications: ReadonlyArray<{
    readonly kind: string
    readonly status: string
    readonly externalId?: string | undefined
    readonly url?: string | undefined
    readonly summary?: string | undefined
    readonly idempotencyKey?: string | undefined
  }>,
) {
  return publications.map((publication) => ({
    kind: publication.kind,
    status: publication.status,
    ...(publication.externalId === undefined
      ? {}
      : { externalId: publication.externalId }),
    ...(publication.url === undefined ? {} : { url: publication.url }),
    ...(publication.summary === undefined
      ? {}
      : { summary: publication.summary }),
    ...(publication.idempotencyKey === undefined
      ? {}
      : { idempotencyKey: publication.idempotencyKey }),
  }))
}

export const publishDecision = Effect.fnUntraced(function* (
  request: Request,
  env: WorkerEnv,
) {
  const traceId = yield* randomTraceIdEffect()
  const inputExit = yield* readBoundedJson(request).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(publishDecisionRequestSchema)),
    Effect.exit,
  )

  if (Exit.isFailure(inputExit)) {
    return jsonResponse(
      { ok: false, traceId, error: 'Invalid decision publication request' },
      { status: 400 },
    )
  }

  const input = inputExit.value
  const identityExit = yield* decodePublicationIdentity(input).pipe(Effect.exit)
  if (Exit.isFailure(identityExit)) {
    return jsonResponse(
      { ok: false, traceId, error: 'Workflow and human decision IDs required' },
      { status: 400 },
    )
  }
  const { humanDecisionId, workflowRunId } = identityExit.value

  const routeConfigExit = yield* loadSourceControlRouteConfig(env).pipe(
    Effect.exit,
  )
  if (Exit.isFailure(routeConfigExit)) {
    return jsonResponse(
      { ok: false, traceId, error: 'Decision publication is not configured' },
      { status: 503 },
    )
  }
  const routeConfig = routeConfigExit.value
  const secret = systemIngestionSecret(routeConfig)
  if (secret === undefined) {
    return jsonResponse(
      { ok: false, traceId, error: 'Decision publication is not configured' },
      { status: 503 },
    )
  }

  const fixtureExit = yield* convexQuery({
    url: configuredConvexUrl(routeConfig),
    reference: getDecisionPublicationFixtureQuery,
    args: { systemSecret: secret, workflowRunId, humanDecisionId },
    catch: (cause) =>
      new SourceControlWorkerRequestError({
        message: 'Unable to load decision publication evidence',
        cause,
      }),
  }).pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(decisionPublicationFixtureSchema),
    ),
    Effect.mapError(
      (cause) =>
        new SourceControlWorkerRequestError({
          message: 'Invalid authoritative decision publication evidence',
          cause,
        }),
    ),
    Effect.timeoutOrElse({
      duration: convexOperationTimeoutMilliseconds,
      orElse: () =>
        Effect.fail(
          new SourceControlWorkerRequestError({
            message: 'Decision publication evidence lookup timed out',
          }),
        ),
    }),
    Effect.exit,
  )
  if (Exit.isFailure(fixtureExit)) {
    return jsonResponse(
      {
        ok: false,
        traceId,
        error: 'Authoritative decision evidence unavailable',
      },
      { status: 409 },
    )
  }

  const fixture = fixtureExit.value
  const patchReportExit =
    fixture.workflowStart.workflowRun.modelVersion === 'v1'
      ? yield* AssemblePatchReportV1({
          workflowStart: fixture.workflowStart,
          sandboxExecutions:
            fixture.sandboxExecution === undefined
              ? []
              : [fixture.sandboxExecution],
          candidatePatchSets:
            fixture.candidatePatchSet === undefined
              ? []
              : [fixture.candidatePatchSet],
          verificationRequirements: fixture.verificationRequirements,
          verificationResults: fixture.verificationResults,
          reviewRuns:
            fixture.reviewRun === undefined ? [] : [fixture.reviewRun],
          reviewFindings: fixture.reviewFindings,
          policyDecisions:
            fixture.policyDecision === undefined
              ? []
              : [fixture.policyDecision],
          humanDecisions: [fixture.humanDecision],
          evidenceArtifacts: fixture.evidenceArtifacts,
          publicationResults: fixture.publicationResults,
          trustDataTruncated: fixture.trustDataTruncated,
          evidenceTruncated: fixture.evidenceTruncated,
        }).pipe(Effect.exit)
      : undefined
  if (patchReportExit !== undefined && Exit.isFailure(patchReportExit)) {
    return jsonResponse(
      { ok: false, traceId, error: 'Canonical Patch Report assembly failed' },
      { status: 409 },
    )
  }
  const patchReport =
    patchReportExit !== undefined && Exit.isSuccess(patchReportExit)
      ? patchReportExit.value
      : undefined

  const publicationExit = yield* PublishDecisionToSource({
    traceId: input.traceId,
    workflowStart: fixture.workflowStart,
    humanDecision: fixture.humanDecision,
    ...(fixture.sandboxExecution === undefined
      ? {}
      : { sandboxExecution: fixture.sandboxExecution }),
    ...(fixture.candidatePatchSet === undefined
      ? {}
      : { candidatePatchSet: fixture.candidatePatchSet }),
    ...(patchReport === undefined ? {} : { patchReport }),
    verification: fixture.verification,
    publicationResults: fixture.publicationResults,
  }).pipe(
    (effect) =>
      withTelemetrySpan(
        {
          traceId: input.traceId,
          workflowRunId,
          operation: 'githubWorker.publishDecision',
          name: 'githubWorker.publishDecision',
        },
        effect,
      ),
    (effect) =>
      withCapturedCriticalPathScope(
        {
          traceId: input.traceId,
          workflowRunId,
          operation: 'githubWorker.publishDecision',
          message: 'Decision publication failed',
        },
        effect,
      ),
    Effect.exit,
  )

  if (Exit.isFailure(publicationExit)) {
    yield* Effect.logError('Decision publication failed', {
      traceId: input.traceId,
      workflowRunId,
    })
    return jsonResponse(
      {
        ok: false,
        traceId: input.traceId,
        error: 'Decision publication failed',
      },
      { status: 500 },
    )
  }

  const publications = publicPublications(publicationExit.value.publications)
  if (
    publicationExit.value.publications.some(
      (publication) => publication.status !== 'published',
    )
  ) {
    return jsonResponse(
      {
        ok: false,
        traceId: input.traceId,
        publications,
        error: 'Decision publication failed',
      },
      { status: 500 },
    )
  }

  return jsonResponse({
    ok: true,
    traceId: input.traceId,
    publications,
  })
})
