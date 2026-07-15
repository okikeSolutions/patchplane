import { createHmac, randomUUID } from 'node:crypto'
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { Config, Effect, Redacted, Schema } from 'effect'
import { makeGitHubApp } from '@patchplane/plugins/github/app'
import {
  GitHubConfig,
  type GitHubConfig as GitHubConfigType,
} from '@patchplane/plugins/github/config'

interface AcceptanceSnapshot {
  readonly workflowRunId: string
  readonly workflowStatus: 'queued' | 'running' | 'reviewed'
  readonly hasRuntimeEvents: boolean
  readonly hasRuntimeSessions: boolean
  readonly sandboxExecutionStatuses: ReadonlyArray<'succeeded' | 'failed'>
  readonly evidenceArtifacts: ReadonlyArray<{
    readonly kind: string
    readonly storageKey: string
    readonly sizeBytes: number
    readonly sha256: string
  }>
  readonly candidatePatchStatuses: ReadonlyArray<
    'captured' | 'empty' | 'failed'
  >
  readonly reviewRunStatuses: ReadonlyArray<
    'queued' | 'running' | 'completed' | 'failed'
  >
  readonly policyDecisionStatuses: ReadonlyArray<string>
  readonly humanDecisions: ReadonlyArray<{
    readonly id: string
    readonly status: string
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

const getAcceptanceSnapshot = makeFunctionReference<
  'query',
  { systemSecret: string; workflowRunId: string },
  AcceptanceSnapshot
>('workflowStarts:getTrustLoopAcceptanceSnapshot')

function required(name: string) {
  const value = process.env[name]?.trim()
  if (value === undefined || value.length === 0)
    throw new Error(`${name} is required`)
  return value
}

function requiredSecret(name: string) {
  return Redacted.value(Effect.runSync(Config.redacted(name)))
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

function assertSnapshot(snapshot: AcceptanceSnapshot) {
  if (snapshot.workflowStatus !== 'reviewed')
    throw new Error('Workflow did not reach reviewed status')
  if (!snapshot.hasRuntimeEvents)
    throw new Error('Workflow did not persist Pi runtime events')
  if (snapshot.sandboxExecutionStatuses.length < 1)
    throw new Error('Workflow did not persist a sandbox execution')
  if (!snapshot.candidatePatchStatuses.includes('captured'))
    throw new Error('Workflow did not capture a candidate patch')
  if (!snapshot.reviewRunStatuses.includes('completed'))
    throw new Error('Workflow review did not complete')
  if (snapshot.policyDecisionStatuses.length < 1)
    throw new Error('Workflow did not persist a policy decision')
  if (!snapshot.hasProvenanceEvents)
    throw new Error('Workflow did not persist provenance')
  const diff = snapshot.evidenceArtifacts.find(
    (artifact) => artifact.kind === 'diff',
  )
  if (
    diff === undefined ||
    diff.sizeBytes < 1 ||
    !/^[a-f0-9]{64}$/.test(diff.sha256)
  ) {
    throw new Error('Workflow did not persist a non-empty hashed diff artifact')
  }
}

function convexClient() {
  return new ConvexHttpClient(
    (process.env.CONVEX_URL ?? required('VITE_CONVEX_URL')).replace(/\/$/, ''),
  )
}

function publishedHumanDecision(snapshot: AcceptanceSnapshot) {
  return snapshot.humanDecisions.find((decision) =>
    snapshot.publicationResults.some(
      (publication) =>
        publication.status === 'published' &&
        publication.externalId !== undefined &&
        publication.idempotencyKey?.startsWith(`${decision.id}:`) === true,
    ),
  )
}

async function verifyReviewedWorkflow(
  workflowRunId: string,
  systemSecret: string,
) {
  const snapshot = await convexClient().query(getAcceptanceSnapshot, {
    systemSecret,
    workflowRunId,
  })
  assertSnapshot(snapshot)
  if (publishedHumanDecision(snapshot) === undefined) {
    throw new Error(
      'Workflow has no durable GitHub publication correlated to an authenticated human decision',
    )
  }
  return snapshot
}

async function main(githubConfig: GitHubConfigType) {
  const systemSecret = requiredSecret('PATCHPLANE_SYSTEM_INGESTION_SECRET')
  const existingWorkflowRunId =
    process.env.PATCHPLANE_SMOKE_WORKFLOW_RUN_ID?.trim()
  if (existingWorkflowRunId !== undefined && existingWorkflowRunId.length > 0) {
    const snapshot = await verifyReviewedWorkflow(
      existingWorkflowRunId,
      systemSecret,
    )
    console.log(
      JSON.stringify({
        type: 'trust_loop_complete',
        workflowRunId: existingWorkflowRunId,
        humanDecisions: snapshot.humanDecisions,
        publicationResults: snapshot.publicationResults,
      }),
    )
    return
  }

  const repositoryFullName = required('PATCHPLANE_SMOKE_REPOSITORY_FULL_NAME')
  const [owner, repositoryName] = repositoryFullName.split('/')
  if (owner === undefined || repositoryName === undefined) {
    throw new Error(
      'PATCHPLANE_SMOKE_REPOSITORY_FULL_NAME must be owner/repository',
    )
  }

  const { app } = makeGitHubApp(githubConfig)
  const installations = await app.octokit.paginate(
    app.octokit.rest.apps.listInstallations,
    { per_page: 100 },
  )
  let installationId: number | undefined
  let octokit:
    | Awaited<ReturnType<typeof app.getInstallationOctokit>>
    | undefined
  for (const installation of installations) {
    const client = await app.getInstallationOctokit(installation.id)
    const repositories = await client.paginate(
      client.rest.apps.listReposAccessibleToInstallation,
      { per_page: 100 },
    )
    if (
      repositories.some(
        (repository) =>
          repository.full_name.toLowerCase() ===
          repositoryFullName.toLowerCase(),
      )
    ) {
      installationId = installation.id
      octokit = client
      break
    }
  }
  if (installationId === undefined || octokit === undefined) {
    throw new Error(`GitHub App is not installed for ${repositoryFullName}`)
  }

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
    !Number.isSafeInteger(pullRequestNumber) ||
    pullRequestNumber === undefined
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
  console.log(
    JSON.stringify({
      type: 'trust_loop_started',
      webhookUrl,
      repositoryFullName,
      pullRequestNumber,
      deliveryId,
    }),
  )
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
      `Trust-loop webhook failed (${response.status}): ${result.error ?? JSON.stringify(result)}`,
    )
  }

  const snapshot = await convexClient().query(getAcceptanceSnapshot, {
    systemSecret,
    workflowRunId: result.workflowRunId,
  })
  assertSnapshot(snapshot)

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

  console.log(
    JSON.stringify({
      type: 'trust_loop_review_ready',
      workflowRunId: result.workflowRunId,
      sandboxStatus: result.sandboxStatus,
      hasRuntimeEvents: snapshot.hasRuntimeEvents,
      hasRuntimeSessions: snapshot.hasRuntimeSessions,
      artifactCount: snapshot.evidenceArtifacts.length,
      hasProvenanceEvents: snapshot.hasProvenanceEvents,
      publicationUrl: publication.html_url,
    }),
  )

  if (publishedHumanDecision(snapshot) === undefined) {
    throw new Error(
      [
        'Pre-decision trust loop passed, but full M10 acceptance still requires an authenticated human decision.',
        `Open the deployed client workflow ${result.workflowRunId}, submit a decision, then rerun acceptance against that workflow.`,
      ].join(' '),
    )
  }
}

await main(Effect.runSync(GitHubConfig))
