import { ConvexHttpClient } from 'convex/browser'
import { Cause, Effect, Exit, Schema } from 'effect'
import { loadSourceControlRouteConfig, type WorkerEnv } from '../config'
import { AssemblePatchReportV1 } from '@patchplane/core/patch-report/assemble-patch-report-v1'
import { PublishDecisionToSource } from '@patchplane/core/workflows/publish-decision-to-source'
import { withTelemetrySpan } from '@patchplane/core/services/telemetry-service'
import { publicErrorMessage } from '@patchplane/domain/errors'
import { withCapturedCriticalPathScope } from '../../critical-path-telemetry'
import {
  type SourceControlRuntime,
  SourceControlWorkerRequestError,
  publishDecisionRequestSchema,
  decisionPublicationFixtureSchema,
  getDecisionPublicationFixtureQuery,
  jsonResponse,
  nestedString,
  configuredConvexUrl,
  systemIngestionSecret,
  randomTraceId,
} from './support'

export async function publishDecision(
  request: Request,
  env: WorkerEnv,
  runtime: SourceControlRuntime,
) {
  const traceId = await randomTraceId(runtime)
  const inputExit = await runtime.runPromiseExit(
    Effect.tryPromise({
      try: () => request.json(),
      catch: (cause) =>
        new SourceControlWorkerRequestError({
          message: `Invalid JSON body: ${String(cause)}`,
        }),
    }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(publishDecisionRequestSchema)),
    ),
  )

  if (Exit.isFailure(inputExit)) {
    return jsonResponse(
      { ok: false, traceId, error: 'Invalid decision publication request' },
      { status: 400 },
    )
  }

  const input = inputExit.value
  const workflowRunId =
    input.workflowRunId ??
    nestedString(input.workflowStart, 'workflowRun', 'id')
  const humanDecisionId =
    input.humanDecisionId ?? nestedString(input.humanDecision, 'id')
  if (workflowRunId === undefined || humanDecisionId === undefined) {
    return jsonResponse(
      { ok: false, traceId, error: 'Workflow and human decision IDs required' },
      { status: 400 },
    )
  }

  const routeConfigExit = await runtime.runPromiseExit(
    loadSourceControlRouteConfig(env),
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
  const fixtureExit = await runtime.runPromiseExit(
    Effect.tryPromise({
      try: () =>
        new ConvexHttpClient(configuredConvexUrl(routeConfig)).query(
          getDecisionPublicationFixtureQuery,
          { systemSecret: secret, workflowRunId, humanDecisionId },
        ),
      catch: (cause) =>
        new SourceControlWorkerRequestError({
          message: `Unable to load decision publication evidence: ${String(cause)}`,
        }),
    }).pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(decisionPublicationFixtureSchema),
      ),
    ),
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
      ? await runtime.runPromiseExit(
          AssemblePatchReportV1({
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
          }),
        )
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
  const publicationExit = await runtime.runPromiseExit(
    PublishDecisionToSource({
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
    ),
  )

  if (Exit.isFailure(publicationExit)) {
    const error = publicErrorMessage(
      Cause.squash(publicationExit.cause),
      'Decision publication failed',
    )
    await runtime.runPromise(
      Effect.logError('Decision publication failed', {
        traceId: input.traceId,
        cause: Cause.pretty(publicationExit.cause),
        error,
      }),
    )
    return jsonResponse(
      { ok: false, traceId: input.traceId, error },
      { status: 500 },
    )
  }

  const failed = publicationExit.value.publications.filter(
    (publication) => publication.status === 'failed',
  )
  if (failed.length > 0) {
    return jsonResponse(
      {
        ok: false,
        traceId: input.traceId,
        publications: publicationExit.value.publications,
        error: failed
          .map(
            (publication) =>
              publication.error ?? publication.summary ?? publication.kind,
          )
          .join('; '),
      },
      { status: 500 },
    )
  }

  return jsonResponse({
    ok: true,
    traceId: input.traceId,
    publications: publicationExit.value.publications,
  })
}
