import { createHmac, randomUUID } from 'node:crypto'
import { NodeServices } from '@effect/platform-node'
import { SourceControlService } from '@patchplane/core/services/source-control-service'
import { makeGitHubApp } from '@patchplane/plugins/github/app'
import {
  GitHubConfig,
  type GitHubConfig as GitHubConfigType,
} from '@patchplane/plugins/github/config'
import { GitHubProviderPlugin } from '@patchplane/plugins/github/provider-plugin'
import { Effect, Layer, ManagedRuntime, Redacted } from 'effect'
import { sourceControlConfigLayer } from '../../github/config'
import {
  formatSmokePreflightSummary,
  inspectSmokePreflight,
} from '../smoke-preflight'
import {
  type GitHubApp,
  decodeTrustLoopWebhookResponse,
  emit,
  publicUrlLocation,
  required,
  requiredSecret,
  resolveWebhookUrl,
} from './support'
import {
  assertGitHubPublicationReadback,
  assertIdenticalReplayState,
  assertPublishedFixture,
  expectedPublicationTargets,
  githubCoordinates,
  latestPublishedHumanDecision,
  publicationKey,
  readAcceptanceSnapshot,
  readGitHubPublicationInventory,
  readReplayFixture,
  waitForWorkflowDelivery,
} from './publication'

async function verifyPostDecision(
  githubConfig: GitHubConfigType,
  workflowRunId: string,
  systemSecret: string,
  replay: boolean,
) {
  const snapshot = await readAcceptanceSnapshot(workflowRunId, systemSecret)
  const correlatedDecision = latestPublishedHumanDecision(snapshot)
  if (correlatedDecision === undefined) {
    throw new Error(
      'Workflow has no durable GitHub publication correlated to an authenticated human decision',
    )
  }

  const beforeFixture = await readReplayFixture(
    workflowRunId,
    correlatedDecision.id,
    systemSecret,
  )
  assertPublishedFixture(beforeFixture)
  const { app } = makeGitHubApp(githubConfig)
  const coordinates = githubCoordinates(beforeFixture)
  const octokit = await app.getInstallationOctokit(coordinates.installationId)
  const beforeInventory = await readGitHubPublicationInventory(
    octokit,
    beforeFixture,
  )
  assertGitHubPublicationReadback(beforeFixture, beforeInventory)

  if (replay) {
    const replayLayer = Layer.mergeAll(
      GitHubProviderPlugin.layer,
      NodeServices.layer,
    ).pipe(Layer.provide(sourceControlConfigLayer(process.env)))
    const runtime = ManagedRuntime.make(replayLayer, {
      memoMap: Layer.makeMemoMapUnsafe(),
    })
    try {
      const replayResults = await runtime.runPromise(
        Effect.gen(function* () {
          const sourceControl = yield* SourceControlService
          const results: Array<{
            readonly kind: 'issue-comment' | 'check-run'
            readonly externalId?: string
          }> = []
          for (const kind of expectedPublicationTargets(beforeFixture)) {
            const idempotencyKey = publicationKey(
              beforeFixture.humanDecision.id,
              kind,
            )
            const published =
              kind === 'issue-comment'
                ? yield* sourceControl.createIssueComment({
                    provider: 'github',
                    installationId: String(coordinates.installationId),
                    owner: coordinates.owner,
                    name: coordinates.repositoryName,
                    issueNumber: coordinates.issueNumber!,
                    body: 'PatchPlane acceptance replay; existing publication must be reused.',
                    idempotencyKey,
                    traceId: beforeFixture.workflowStart.workflowRun.traceId,
                    operation: 'trustLoopSmoke.replayIssueComment',
                  })
                : yield* sourceControl.createCheckRun({
                    provider: 'github',
                    installationId: String(coordinates.installationId),
                    owner: coordinates.owner,
                    name: coordinates.repositoryName,
                    headSha: coordinates.headSha!,
                    checkName: 'PatchPlane Review',
                    status: 'completed',
                    conclusion:
                      beforeFixture.humanDecision.status === 'rejected'
                        ? 'failure'
                        : beforeFixture.humanDecision.status ===
                            'changes-requested'
                          ? 'action_required'
                          : 'success',
                    title: `PatchPlane: ${beforeFixture.humanDecision.status}`,
                    summary:
                      'PatchPlane acceptance replay; existing publication must be reused.',
                    idempotencyKey,
                    traceId: beforeFixture.workflowStart.workflowRun.traceId,
                    operation: 'trustLoopSmoke.replayCheckRun',
                  })
            results.push({
              kind,
              ...(published.externalId === undefined
                ? {}
                : { externalId: published.externalId }),
            })
          }
          return results
        }),
      )
      for (const result of replayResults) {
        const durable = beforeFixture.publicationResults.find(
          (publication) => publication.kind === result.kind,
        )
        if (
          result.externalId === undefined ||
          result.externalId !== durable?.externalId
        ) {
          throw new Error(
            `Provider replay did not reuse the durable ${result.kind} external ID`,
          )
        }
      }
    } finally {
      await runtime.dispose()
    }

    const afterFixture = await readReplayFixture(
      workflowRunId,
      correlatedDecision.id,
      systemSecret,
    )
    const afterInventory = await readGitHubPublicationInventory(
      octokit,
      afterFixture,
    )
    assertGitHubPublicationReadback(afterFixture, afterInventory)
    assertIdenticalReplayState(
      beforeFixture,
      afterFixture,
      beforeInventory,
      afterInventory,
    )
    emit({
      type: 'trust_loop_publication_replayed',
      workflowRunId,
      humanDecisionId: correlatedDecision.id,
      issueCommentCount: afterInventory.issueComment.length,
      checkRunCount: afterInventory.checkRun.length,
      externalIdsUnchanged: true,
    })
  }

  emit({
    type: 'trust_loop_complete',
    workflowRunId,
    humanDecisionId: correlatedDecision.id,
    humanDecisionStatus: beforeFixture.humanDecision.status,
    publicationResults: beforeFixture.publicationResults.map((publication) => ({
      kind: publication.kind,
      status: publication.status,
      externalId: publication.externalId,
      idempotencyKey: publication.idempotencyKey,
    })),
    githubReadback: {
      issueCommentCount: beforeInventory.issueComment.length,
      checkRunCount: beforeInventory.checkRun.length,
    },
    replayed: replay,
  })
}

async function findInstallation(app: GitHubApp, repositoryFullName: string) {
  const installations = await app.octokit.paginate(
    app.octokit.rest.apps.listInstallations,
    { per_page: 100 },
  )
  for (const installation of installations) {
    const octokit = await app.getInstallationOctokit(installation.id)
    const repositories = await octokit.paginate(
      octokit.rest.apps.listReposAccessibleToInstallation,
      { per_page: 100 },
    )
    if (
      repositories.some(
        (repository) =>
          repository.full_name.toLowerCase() ===
          repositoryFullName.toLowerCase(),
      )
    ) {
      return { installationId: installation.id, octokit }
    }
  }
  throw new Error(`GitHub App is not installed for ${repositoryFullName}`)
}

async function runFresh(
  githubConfig: GitHubConfigType,
  reviewReadyOnly: boolean,
) {
  const systemSecret = requiredSecret('PATCHPLANE_SYSTEM_INGESTION_SECRET')
  const repositoryFullName = required('PATCHPLANE_SMOKE_REPOSITORY_FULL_NAME')
  const [owner, repositoryName, extra] = repositoryFullName.split('/')
  if (
    owner === undefined ||
    repositoryName === undefined ||
    extra !== undefined
  ) {
    throw new Error(
      'PATCHPLANE_SMOKE_REPOSITORY_FULL_NAME must be owner/repository',
    )
  }

  const { app } = makeGitHubApp(githubConfig)
  const { installationId, octokit } = await findInstallation(
    app,
    repositoryFullName,
  )
  const configuredPullRequest = process.env.PATCHPLANE_SMOKE_PULL_REQUEST_NUMBER
  const pullRequestNumber =
    configuredPullRequest === undefined
      ? (
          await octokit.rest.pulls.list({
            owner,
            repo: repositoryName,
            state: 'open',
            per_page: 1,
          })
        ).data[0]?.number
      : Number(configuredPullRequest)
  if (
    pullRequestNumber === undefined ||
    !Number.isSafeInteger(pullRequestNumber)
  ) {
    throw new Error(
      `${repositoryFullName} needs an open pull request for the trust-loop smoke`,
    )
  }
  const pullRequest = (
    await octokit.rest.pulls.get({
      owner,
      repo: repositoryName,
      pull_number: pullRequestNumber,
    })
  ).data
  const commentsBefore = await octokit.paginate(
    octokit.rest.issues.listComments,
    {
      owner,
      repo: repositoryName,
      issue_number: pullRequestNumber,
      per_page: 100,
    },
  )
  const existingCommentIds = new Set(
    commentsBefore.map((comment) => comment.id),
  )
  const deliveryId = `patchplane-live-${randomUUID()}`
  const payload = JSON.stringify({
    action: 'opened',
    installation: { id: installationId },
    repository: {
      id: pullRequest.base.repo.id,
      name: repositoryName,
      owner: { login: owner },
    },
    sender: { login: 'patchplane-live-smoke' },
    pull_request: {
      id: pullRequest.id,
      number: pullRequest.number,
      title: pullRequest.title,
      body: pullRequest.body ?? '',
      html_url: pullRequest.html_url,
      updated_at: pullRequest.updated_at,
      head: { ref: pullRequest.head.ref, sha: pullRequest.head.sha },
      base: { ref: pullRequest.base.ref, sha: pullRequest.base.sha },
    },
  })
  const signature = `sha256=${createHmac(
    'sha256',
    Redacted.value(githubConfig.webhookSecret),
  )
    .update(payload)
    .digest('hex')}`
  const webhookUrl = await resolveWebhookUrl()
  emit({
    type: 'trust_loop_started',
    webhookUrl: publicUrlLocation(webhookUrl),
    repositoryFullName,
    pullRequestNumber,
    deliveryId,
  })
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-delivery': deliveryId,
      'x-github-event': 'pull_request',
      'x-hub-signature-256': signature,
    },
    body: payload,
    signal: AbortSignal.timeout(
      Number(process.env.PATCHPLANE_SMOKE_TIMEOUT_MS ?? 600_000),
    ),
  })
  const result = decodeTrustLoopWebhookResponse(await response.json())
  if (
    response.status !== 202 ||
    result.ok !== true ||
    (result.workflowRunId === undefined && result.queued !== true)
  ) {
    throw new Error(
      `Trust-loop webhook failed (${response.status}): ${result.error ?? 'unknown error'}`,
    )
  }

  const workflowRunId =
    result.workflowRunId ??
    (await waitForWorkflowDelivery(
      result.deliveryId ?? deliveryId,
      systemSecret,
    ))
  emit({
    type: 'trust_loop_workflow_accepted',
    workflowRunId,
  })
  const snapshot = await readAcceptanceSnapshot(
    workflowRunId,
    systemSecret,
    pullRequest.head.sha,
  )
  const commentsAfter = await octokit.paginate(
    octokit.rest.issues.listComments,
    {
      owner,
      repo: repositoryName,
      issue_number: pullRequestNumber,
      per_page: 100,
    },
  )
  const publication = commentsAfter.find(
    (comment) =>
      !existingCommentIds.has(comment.id) &&
      comment.body?.startsWith('## PatchPlane Patch Report'),
  )
  if (
    !reviewReadyOnly &&
    (publication === undefined ||
      result.publishedIssueNumber !== pullRequestNumber)
  ) {
    throw new Error(
      'Trust loop did not publish a new Patch Report comment to the source pull request',
    )
  }

  emit({
    type: 'trust_loop_review_ready',
    workflowRunId,
    sandboxStatus: result.sandboxStatus,
    hasRuntimeEvents: snapshot.hasRuntimeEvents,
    hasRuntimeSessions: snapshot.hasRuntimeSessions,
    artifactCount: snapshot.evidenceArtifacts.length,
    hasProvenanceEvents: snapshot.hasProvenanceEvents,
    ...(publication === undefined
      ? {}
      : { publicationUrl: publication.html_url }),
  })

  if (reviewReadyOnly) {
    if (
      snapshot.latestCandidatePatchSet?.subjectKind !==
        'incoming-pull-request' &&
      snapshot.latestSandboxExecution?.status !== 'succeeded'
    ) {
      throw new Error(
        'Convex sandbox smoke requires the latest sandbox execution to succeed',
      )
    }
    emit({
      type: 'trust_loop_summary',
      ok: true,
      mode: 'fresh',
      completion: 'review-ready',
      m10Complete: false,
      workflowRunId,
    })
    return true
  }

  emit({
    type: 'trust_loop_human_decision_required',
    ok: false,
    workflowRunId,
    instruction:
      'Submit an authenticated decision in the deployed client, then rerun with PATCHPLANE_SMOKE_WORKFLOW_RUN_ID.',
  })
  emit({
    type: 'trust_loop_summary',
    ok: false,
    mode: 'fresh',
    completion: 'human-decision-required',
    m10Complete: false,
    workflowRunId,
  })
  return false
}

export async function orchestrate(
  argv: readonly string[] = process.argv.slice(2),
) {
  const acceptedArguments = new Set(['--review-ready-only'])
  const unsupportedArgument = argv.find(
    (argument) => !acceptedArguments.has(argument),
  )
  if (unsupportedArgument !== undefined) {
    emit({
      type: 'trust_loop_summary',
      ok: false,
      completion: 'invalid-arguments',
      m10Complete: false,
    })
    return false
  }
  const reviewReadyOnly = argv.includes('--review-ready-only')
  const workflowRunId = process.env.PATCHPLANE_SMOKE_WORKFLOW_RUN_ID?.trim()
  const replay = process.env.PATCHPLANE_SMOKE_REPLAY_PUBLICATION === 'true'
  const target = reviewReadyOnly ? 'convex-sandbox' : 'trust-loop'
  const preflight = inspectSmokePreflight(target, process.env)
  console.log(formatSmokePreflightSummary(preflight))
  if (!preflight.ok) {
    emit({
      type: 'trust_loop_summary',
      ok: false,
      mode: preflight.mode,
      completion: 'preflight-failed',
      m10Complete: false,
    })
    return false
  }
  if (replay && (workflowRunId === undefined || workflowRunId.length === 0)) {
    emit({
      type: 'trust_loop_summary',
      ok: false,
      mode: preflight.mode,
      completion: 'replay-requires-workflow',
      m10Complete: false,
    })
    return false
  }

  try {
    const githubConfig = Effect.runSync(GitHubConfig)
    if (workflowRunId !== undefined && workflowRunId.length > 0) {
      await verifyPostDecision(
        githubConfig,
        workflowRunId,
        requiredSecret('PATCHPLANE_SYSTEM_INGESTION_SECRET'),
        replay,
      )
      emit({
        type: 'trust_loop_summary',
        ok: true,
        mode: 'post-decision',
        completion: replay ? 'publication-replayed' : 'verified',
        automatedChecksComplete: replay,
        m10Complete: false,
        requiresHumanUiReadback: replay,
        workflowRunId,
      })
      return true
    }
    return await runFresh(githubConfig, reviewReadyOnly)
  } catch (error) {
    const taggedFailure =
      typeof error === 'object' && error !== null
        ? Reflect.get(error, '_tag')
        : undefined
    const failure =
      error instanceof Error
        ? error.message.slice(0, 512)
        : typeof error === 'object' &&
            error !== null &&
            'message' in error &&
            typeof error.message === 'string'
          ? error.message.slice(0, 512)
          : typeof taggedFailure === 'string'
            ? `Trust-loop Effect failure: ${taggedFailure.slice(0, 128)}`
            : 'Unknown trust-loop acceptance failure'
    emit({
      type: 'trust_loop_summary',
      ok: false,
      mode: preflight.mode,
      completion: 'failed',
      m10Complete: false,
      errorCategory: 'acceptance-check-failed',
      failure,
    })
    return false
  }
}
