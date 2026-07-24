#!/usr/bin/env bun
import { createHmac, randomUUID } from 'node:crypto'
import { NodeServices } from '@effect/platform-node'
import { SourceControlService } from '@patchplane/core/services/source-control-service'
import {
  HumanDecision,
  PublicationResult,
} from '@patchplane/domain/decision-review'
import { WorkflowStart } from '@patchplane/domain/workflow-start'
import { makeGitHubApp } from '@patchplane/plugins/github/app'
import {
  GitHubConfig,
  type GitHubConfig as GitHubConfigType,
} from '@patchplane/plugins/github/config'
import { GitHubProviderPlugin } from '@patchplane/plugins/github/provider-plugin'
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { Config, Effect, Layer, ManagedRuntime, Redacted, Schema } from 'effect'
import { sourceControlConfigLayer } from '../github/config'
import {
  formatSmokePreflightSummary,
  inspectSmokePreflight,
} from './smoke-preflight'

export interface AcceptanceSnapshot {
  readonly workflowRunId: string
  readonly workflowStatus: 'queued' | 'running' | 'reviewed'
  readonly hasRuntimeEvents: boolean
  readonly hasRuntimeSessions: boolean
  readonly sandboxExecutionStatuses: ReadonlyArray<'succeeded' | 'failed'>
  readonly latestSandboxExecution?: {
    readonly id: string
    readonly status: 'succeeded' | 'failed'
    readonly completedAt: number
  }
  readonly evidenceArtifacts: ReadonlyArray<{
    readonly id: string
    readonly kind: string
    readonly storageKey: string
    readonly sizeBytes: number
    readonly sha256: string
    readonly createdAt: number
  }>
  readonly candidatePatchStatuses: ReadonlyArray<
    'captured' | 'empty' | 'failed'
  >
  readonly latestCandidatePatchSet?: {
    readonly id: string
    readonly status: 'captured' | 'empty' | 'failed'
    readonly diffArtifactId?: string
    readonly headSha?: string
    readonly createdAt: number
  }
  readonly reviewRunStatuses: ReadonlyArray<
    'queued' | 'running' | 'completed' | 'failed'
  >
  readonly latestReviewRun?: {
    readonly id: string
    readonly sandboxExecutionId?: string
    readonly candidatePatchSetId?: string
    readonly status: 'queued' | 'running' | 'completed' | 'failed'
    readonly createdAt: number
  }
  readonly policyDecisionStatuses: ReadonlyArray<string>
  readonly latestPolicyDecision?: {
    readonly status: string
    readonly reviewRunId?: string
    readonly createdAt: number
  }
  readonly humanDecisions: ReadonlyArray<{
    readonly id: string
    readonly status: string
    readonly decidedAt: number
    readonly idempotencyKey?: string
  }>
  readonly publicationResults: ReadonlyArray<{
    readonly kind: string
    readonly status: string
    readonly externalId?: string
    readonly url?: string
    readonly idempotencyKey?: string
  }>
  readonly hasProvenanceEvents: boolean
}

const DecisionPublicationReplayFixture = Schema.Struct({
  workflowStart: WorkflowStart,
  humanDecision: HumanDecision,
  candidateHeadSha: Schema.optional(Schema.String),
  publicationResults: Schema.Array(PublicationResult),
})
type DecisionPublicationReplayFixture = Schema.Schema.Type<
  typeof DecisionPublicationReplayFixture
>

const CloudflareScriptsResponse = Schema.Struct({
  result: Schema.optional(
    Schema.Array(Schema.Struct({ id: Schema.optional(Schema.String) })),
  ),
})
const CloudflareSubdomainResponse = Schema.Struct({
  result: Schema.optional(
    Schema.Struct({ subdomain: Schema.optional(Schema.String) }),
  ),
})
const TrustLoopWebhookResponse = Schema.Struct({
  ok: Schema.optional(Schema.Boolean),
  error: Schema.optional(Schema.String),
  workflowRunId: Schema.optional(Schema.String),
  sandboxStatus: Schema.optional(Schema.String),
  publishedIssueNumber: Schema.optional(Schema.Number),
})

const decodeCloudflareScriptsResponse = Schema.decodeUnknownSync(
  CloudflareScriptsResponse,
)
const decodeCloudflareSubdomainResponse = Schema.decodeUnknownSync(
  CloudflareSubdomainResponse,
)
const decodeTrustLoopWebhookResponse = Schema.decodeUnknownSync(
  TrustLoopWebhookResponse,
)
export const decodeDecisionPublicationReplayFixture = Schema.decodeUnknownSync(
  DecisionPublicationReplayFixture,
)

const getAcceptanceSnapshot = makeFunctionReference<
  'query',
  { systemSecret: string; workflowRunId: string },
  AcceptanceSnapshot
>('workflowStarts:getTrustLoopAcceptanceSnapshot')

const getDecisionPublicationReplayFixture = makeFunctionReference<
  'query',
  {
    systemSecret: string
    workflowRunId: string
    humanDecisionId: string
  },
  unknown
>('workflowStarts:getDecisionPublicationReplayFixture')

type GitHubApp = ReturnType<typeof makeGitHubApp>['app']
type GitHubInstallationClient = Awaited<
  ReturnType<GitHubApp['getInstallationOctokit']>
>

interface GitHubPublicationInventory {
  readonly issueComment: ReadonlyArray<string>
  readonly checkRun: ReadonlyArray<string>
}

function emit(value: unknown) {
  console.log(JSON.stringify(value))
}

function publicUrlLocation(value: string) {
  const url = new URL(value)
  return `${url.origin}${url.pathname}`
}

function required(name: string) {
  const value = process.env[name]?.trim()
  if (value === undefined || value.length === 0)
    throw new Error(`${name} is required`)
  return value
}

function requiredSecret(name: string) {
  return Redacted.value(Effect.runSync(Config.redacted(name)))
}

function convexClient() {
  return new ConvexHttpClient(
    (process.env.CONVEX_URL ?? required('VITE_CONVEX_URL')).replace(/\/$/, ''),
  )
}

async function resolveWebhookUrl() {
  const configured = process.env.PATCHPLANE_TRUST_LOOP_WEBHOOK_URL?.trim()
  if (configured !== undefined && configured.length > 0) return configured

  const accountId = required('CLOUDFLARE_ACCOUNT_ID')
  const apiToken = requiredSecret('CLOUDFLARE_API_TOKEN')
  const headers = { authorization: `Bearer ${apiToken}` }
  const [scriptsResponse, subdomainResponse] = await Promise.all([
    fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts`,
      { headers },
    ),
    fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`,
      { headers },
    ),
  ])
  if (!scriptsResponse.ok || !subdomainResponse.ok) {
    throw new Error(
      'Cloudflare failed to resolve the deployed trust-loop webhook Worker',
    )
  }
  const scripts = decodeCloudflareScriptsResponse(await scriptsResponse.json())
  const subdomain = decodeCloudflareSubdomainResponse(
    await subdomainResponse.json(),
  )
  const worker = scripts.result
    ?.map((script) => script.id)
    .filter((id): id is string => id !== undefined)
    .find((id) => id.includes('githubwebhookworker'))
  if (worker === undefined || subdomain.result?.subdomain === undefined) {
    throw new Error('No deployed PatchPlane GitHub webhook Worker was found')
  }
  return `https://${worker}.${subdomain.result.subdomain}.workers.dev/api/github/webhook`
}

export function assertSnapshot(snapshot: AcceptanceSnapshot) {
  if (snapshot.workflowStatus !== 'reviewed')
    throw new Error('Workflow did not reach reviewed status')
  if (!snapshot.hasRuntimeEvents)
    throw new Error('Workflow did not persist Pi runtime events')

  const sandbox = snapshot.latestSandboxExecution
  if (sandbox === undefined)
    throw new Error('Workflow did not persist a sandbox execution')

  const candidate = snapshot.latestCandidatePatchSet
  if (candidate?.status !== 'captured')
    throw new Error('Latest workflow candidate patch was not captured')
  if (candidate.createdAt < sandbox.completedAt) {
    throw new Error('Candidate patch predates the latest sandbox execution')
  }

  const review = snapshot.latestReviewRun
  if (review?.status !== 'completed')
    throw new Error('Latest workflow review did not complete')
  if (
    review.sandboxExecutionId !== sandbox.id ||
    review.candidatePatchSetId !== candidate.id
  ) {
    throw new Error(
      'Latest review is not linked to the latest sandbox and candidate patch',
    )
  }

  const policy = snapshot.latestPolicyDecision
  if (policy === undefined)
    throw new Error('Workflow did not persist a policy decision')
  if (policy.reviewRunId !== review.id) {
    throw new Error('Latest policy decision is not linked to the latest review')
  }
  if (policy.createdAt < review.createdAt) {
    throw new Error('Policy decision predates the latest review')
  }
  if (!snapshot.hasProvenanceEvents)
    throw new Error('Workflow did not persist provenance')

  const diff = snapshot.evidenceArtifacts.find(
    (artifact) => artifact.id === candidate.diffArtifactId,
  )
  if (
    diff?.kind !== 'diff' ||
    diff.sizeBytes < 1 ||
    !/^[a-f0-9]{64}$/.test(diff.sha256)
  ) {
    throw new Error(
      'Latest candidate does not reference a non-empty hashed diff artifact',
    )
  }
}

export function latestPublishedHumanDecision(snapshot: AcceptanceSnapshot) {
  const latestDecision = snapshot.humanDecisions.reduce<
    AcceptanceSnapshot['humanDecisions'][number] | undefined
  >(
    (latest, decision) =>
      latest === undefined || decision.decidedAt > latest.decidedAt
        ? decision
        : latest,
    undefined,
  )
  if (latestDecision === undefined) return undefined
  return snapshot.publicationResults.some(
    (publication) =>
      publication.status === 'published' &&
      publication.externalId !== undefined &&
      publication.idempotencyKey?.startsWith(`${latestDecision.id}:`) === true,
  )
    ? latestDecision
    : undefined
}

async function readAcceptanceSnapshot(
  workflowRunId: string,
  systemSecret: string,
) {
  const snapshot = await convexClient().query(getAcceptanceSnapshot, {
    systemSecret,
    workflowRunId,
  })
  assertSnapshot(snapshot)
  return snapshot
}

async function readReplayFixture(
  workflowRunId: string,
  humanDecisionId: string,
  systemSecret: string,
) {
  const value = await convexClient().query(
    getDecisionPublicationReplayFixture,
    { systemSecret, workflowRunId, humanDecisionId },
  )
  return decodeDecisionPublicationReplayFixture(value)
}

function expectedPublicationTargets(fixture: DecisionPublicationReplayFixture) {
  const ref = fixture.workflowStart.promptRequest.externalRef
  const targets: Array<'issue-comment' | 'check-run'> = []
  if (ref?.issueNumber !== undefined) targets.push('issue-comment')
  if (
    fixture.candidateHeadSha !== undefined ||
    ref?.pullRequestHeadSha !== undefined
  ) {
    targets.push('check-run')
  }
  if (targets.length === 0) {
    throw new Error('Decision has no GitHub publication targets')
  }
  return targets
}

function publicationKey(
  decisionId: string,
  kind: 'issue-comment' | 'check-run',
) {
  return `${decisionId}:${kind}`
}

function assertPublishedFixture(fixture: DecisionPublicationReplayFixture) {
  if (
    fixture.humanDecision.idempotencyKey === undefined ||
    fixture.humanDecision.idempotencyKey.length === 0
  ) {
    throw new Error('Human decision has no durable idempotency key')
  }
  if (
    fixture.humanDecision.workflowRunId !== fixture.workflowStart.workflowRun.id
  ) {
    throw new Error('Human decision does not belong to workflow')
  }

  const expected = expectedPublicationTargets(fixture)
  const byKey = new Map(
    fixture.publicationResults.flatMap((publication) =>
      publication.idempotencyKey === undefined
        ? []
        : [[publication.idempotencyKey, publication] as const],
    ),
  )
  for (const kind of expected) {
    const result = byKey.get(publicationKey(fixture.humanDecision.id, kind))
    if (
      result === undefined ||
      result.kind !== kind ||
      result.status !== 'published' ||
      result.externalId === undefined
    ) {
      throw new Error(`Expected ${kind} is not durably published`)
    }
  }
  if (byKey.size !== expected.length) {
    throw new Error('Replay fixture contains unexpected publication results')
  }
  return expected
}

function durablePublicationIds(fixture: DecisionPublicationReplayFixture) {
  return Object.fromEntries(
    fixture.publicationResults.map((publication) => [
      publication.idempotencyKey,
      {
        kind: publication.kind,
        status: publication.status,
        externalId: publication.externalId,
      },
    ]),
  )
}

function githubCoordinates(fixture: DecisionPublicationReplayFixture) {
  const ref = fixture.workflowStart.promptRequest.externalRef
  if (
    ref?.repositoryProvider !== 'github' ||
    ref.repositoryInstallationId === undefined ||
    ref.repositoryOwner === undefined ||
    ref.repositoryName === undefined
  ) {
    throw new Error(
      'Replay fixture has no durable GitHub repository coordinates',
    )
  }
  const installationId = Number(ref.repositoryInstallationId)
  if (!Number.isSafeInteger(installationId) || installationId <= 0) {
    throw new Error('Replay fixture has an invalid GitHub installation ID')
  }
  return {
    installationId,
    owner: ref.repositoryOwner,
    repositoryName: ref.repositoryName,
    issueNumber: ref.issueNumber,
    headSha: fixture.candidateHeadSha ?? ref.pullRequestHeadSha,
  }
}

function issueCommentMarker(idempotencyKey: string) {
  return `<!-- patchplane-publication:${encodeURIComponent(idempotencyKey)} -->`
}

async function readGitHubPublicationInventory(
  octokit: GitHubInstallationClient,
  fixture: DecisionPublicationReplayFixture,
): Promise<GitHubPublicationInventory> {
  const coordinates = githubCoordinates(fixture)
  const decisionId = fixture.humanDecision.id
  const issueComment =
    coordinates.issueNumber === undefined
      ? []
      : (
          await octokit.paginate(octokit.rest.issues.listComments, {
            owner: coordinates.owner,
            repo: coordinates.repositoryName,
            issue_number: coordinates.issueNumber,
            per_page: 100,
          })
        )
          .filter((comment) =>
            comment.body?.includes(
              issueCommentMarker(publicationKey(decisionId, 'issue-comment')),
            ),
          )
          .map((comment) => String(comment.id))

  const checkRun =
    coordinates.headSha === undefined
      ? []
      : (
          await octokit.paginate(octokit.rest.checks.listForRef, {
            owner: coordinates.owner,
            repo: coordinates.repositoryName,
            ref: coordinates.headSha,
            check_name: 'PatchPlane Review',
            filter: 'all',
            per_page: 100,
          })
        )
          .filter(
            (check) =>
              check.external_id === publicationKey(decisionId, 'check-run'),
          )
          .map((check) => String(check.id))

  return { issueComment, checkRun }
}

export function assertGitHubPublicationReadback(
  fixture: DecisionPublicationReplayFixture,
  inventory: GitHubPublicationInventory,
) {
  const expected = assertPublishedFixture(fixture)
  for (const kind of expected) {
    const ids =
      kind === 'issue-comment' ? inventory.issueComment : inventory.checkRun
    const durable = fixture.publicationResults.find(
      (publication) =>
        publication.idempotencyKey ===
        publicationKey(fixture.humanDecision.id, kind),
    )
    if (
      ids.length !== 1 ||
      durable?.externalId === undefined ||
      ids[0] !== durable.externalId
    ) {
      throw new Error(
        `GitHub ${kind} readback did not match its durable external ID`,
      )
    }
  }
}

function haveSameIds(
  before: ReadonlyArray<string>,
  after: ReadonlyArray<string>,
) {
  return (
    before.length === after.length && before.every((id) => after.includes(id))
  )
}

function assertIdenticalReplayState(
  beforeFixture: DecisionPublicationReplayFixture,
  afterFixture: DecisionPublicationReplayFixture,
  beforeInventory: GitHubPublicationInventory,
  afterInventory: GitHubPublicationInventory,
) {
  if (
    JSON.stringify(durablePublicationIds(beforeFixture)) !==
    JSON.stringify(durablePublicationIds(afterFixture))
  ) {
    throw new Error('Durable publication IDs changed during replay')
  }
  if (
    !haveSameIds(beforeInventory.issueComment, afterInventory.issueComment) ||
    !haveSameIds(beforeInventory.checkRun, afterInventory.checkRun)
  ) {
    throw new Error('GitHub publication IDs or counts changed during replay')
  }
}

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
    action: 'synchronize',
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
      title: 'PatchPlane live acceptance smoke',
      body: [
        'Create a file named .patchplane/live-e2e.txt containing one line:',
        `PatchPlane live trust loop ${deliveryId}`,
        'Do not change any other file. Then stop.',
      ].join('\n'),
      html_url: pullRequest.html_url,
      head: { ref: pullRequest.head.ref, sha: pullRequest.head.sha },
      base: { ref: pullRequest.base.ref },
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
    result.workflowRunId === undefined
  ) {
    throw new Error(
      `Trust-loop webhook failed (${response.status}): ${result.error ?? 'unknown error'}`,
    )
  }

  const snapshot = await readAcceptanceSnapshot(
    result.workflowRunId,
    systemSecret,
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
    publication === undefined ||
    result.publishedIssueNumber !== pullRequestNumber
  ) {
    throw new Error(
      'Trust loop did not publish a new Patch Report comment to the source pull request',
    )
  }

  emit({
    type: 'trust_loop_review_ready',
    workflowRunId: result.workflowRunId,
    sandboxStatus: result.sandboxStatus,
    hasRuntimeEvents: snapshot.hasRuntimeEvents,
    hasRuntimeSessions: snapshot.hasRuntimeSessions,
    artifactCount: snapshot.evidenceArtifacts.length,
    hasProvenanceEvents: snapshot.hasProvenanceEvents,
    publicationUrl: publication.html_url,
  })

  if (reviewReadyOnly) {
    if (snapshot.latestSandboxExecution?.status !== 'succeeded') {
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
      workflowRunId: result.workflowRunId,
    })
    return true
  }

  emit({
    type: 'trust_loop_human_decision_required',
    ok: false,
    workflowRunId: result.workflowRunId,
    instruction:
      'Submit an authenticated decision in the deployed client, then rerun with PATCHPLANE_SMOKE_WORKFLOW_RUN_ID.',
  })
  emit({
    type: 'trust_loop_summary',
    ok: false,
    mode: 'fresh',
    completion: 'human-decision-required',
    m10Complete: false,
    workflowRunId: result.workflowRunId,
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
  } catch {
    emit({
      type: 'trust_loop_summary',
      ok: false,
      mode: preflight.mode,
      completion: 'failed',
      m10Complete: false,
      errorCategory: 'acceptance-check-failed',
    })
    return false
  }
}

if (import.meta.main) {
  process.exitCode = (await orchestrate()) ? 0 : 1
}
