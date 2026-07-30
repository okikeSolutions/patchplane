import {
  HumanDecision,
  PublicationResult,
} from '@patchplane/domain/decision-review'
import { WorkflowStart } from '@patchplane/domain/workflow-start'
import { makeGitHubApp } from '@patchplane/plugins/github/app'
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { Config, Effect, Redacted, Schema } from 'effect'

export interface AcceptanceSnapshot {
  readonly workflowRunId: string
  readonly workflowStatus: 'queued' | 'running' | 'reviewed' | 'failed'
  readonly hasRuntimeEvents: boolean
  readonly hasRuntimeSessions: boolean
  readonly sandboxExecutionStatuses: ReadonlyArray<'succeeded' | 'failed'>
  readonly sandboxExecutions: ReadonlyArray<{
    readonly id: string
    readonly status: 'succeeded' | 'failed'
    readonly executionGroupId?: string
    readonly providerSessionId?: string
    readonly providerCommandId?: string
  }>
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
    readonly subjectKind?: 'incoming-pull-request' | 'sandbox-generated'
    readonly createdAt: number
  }
  readonly verificationPlans: ReadonlyArray<{
    readonly id: string
    readonly digest: string
    readonly totalCount: number
    readonly requiredCount: number
  }>
  readonly verificationExecutionGroups: ReadonlyArray<{
    readonly id: string
    readonly status:
      | 'claimed'
      | 'running'
      | 'completed'
      | 'failed'
      | 'blocked'
      | 'cancelled'
    readonly sharedState: boolean
    readonly sandboxId?: string
    readonly providerSessionId?: string
    readonly providerCommandId?: string
  }>
  readonly verificationResults: ReadonlyArray<{
    readonly id: string
    readonly verificationPlanId?: string
    readonly executionGroupId?: string
    readonly candidatePatchSetId: string
    readonly requirementId: string
    readonly required: boolean
    readonly sandboxExecutionId?: string
    readonly status: string
    readonly platform: 'linux' | 'macos' | 'windows'
    readonly environmentImage?: string
    readonly providerSessionId?: string
    readonly providerCommandId?: string
    readonly summary?: string
    readonly stdoutCaptureStatus?: 'captured' | 'truncated' | 'failed'
    readonly stderrCaptureStatus?: 'captured' | 'truncated' | 'failed'
    readonly cleanupStatus?: 'deleted' | 'failed' | 'retained' | 'not-started'
    readonly artifactIds: ReadonlyArray<string>
  }>
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

export const DecisionPublicationReplayFixture = Schema.Struct({
  workflowStart: WorkflowStart,
  humanDecision: HumanDecision,
  candidateHeadSha: Schema.optional(Schema.String),
  publicationResults: Schema.Array(PublicationResult),
})
export type DecisionPublicationReplayFixture = Schema.Schema.Type<
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
  queued: Schema.optional(Schema.Boolean),
  deliveryId: Schema.optional(Schema.String),
  sandboxStatus: Schema.optional(Schema.String),
  publishedIssueNumber: Schema.optional(Schema.Finite),
})

const decodeCloudflareScriptsResponse = Schema.decodeUnknownSync(
  CloudflareScriptsResponse,
)
const decodeCloudflareSubdomainResponse = Schema.decodeUnknownSync(
  CloudflareSubdomainResponse,
)
export const decodeTrustLoopWebhookResponse = Schema.decodeUnknownSync(
  TrustLoopWebhookResponse,
)
export const decodeDecisionPublicationReplayFixture = Schema.decodeUnknownSync(
  DecisionPublicationReplayFixture,
)

export const getWorkflowForDelivery = makeFunctionReference<
  'query',
  { systemSecret: string; deliveryId: string },
  { readonly workflowRunId?: string }
>('workflowStarts:getTrustLoopWorkflowForDelivery')

export const getAcceptanceSnapshot = makeFunctionReference<
  'query',
  { systemSecret: string; workflowRunId: string },
  AcceptanceSnapshot
>('workflowStarts:getTrustLoopAcceptanceSnapshot')

export const getDecisionPublicationReplayFixture = makeFunctionReference<
  'query',
  {
    systemSecret: string
    workflowRunId: string
    humanDecisionId: string
  },
  unknown
>('workflowStarts:getDecisionPublicationReplayFixture')

export type GitHubApp = ReturnType<typeof makeGitHubApp>['app']
export type GitHubInstallationClient = Awaited<
  ReturnType<GitHubApp['getInstallationOctokit']>
>

export interface GitHubPublicationInventory {
  readonly issueComment: ReadonlyArray<string>
  readonly checkRun: ReadonlyArray<string>
}

export function emit(value: unknown) {
  console.log(JSON.stringify(value))
}

export function publicUrlLocation(value: string) {
  const url = new URL(value)
  return `${url.origin}${url.pathname}`
}

export function required(name: string) {
  const value = process.env[name]?.trim()
  if (value === undefined || value.length === 0)
    throw new Error(`${name} is required`)
  return value
}

export function requiredSecret(name: string) {
  return Redacted.value(Effect.runSync(Config.redacted(name)))
}

export function convexClient() {
  return new ConvexHttpClient(
    (process.env.CONVEX_URL ?? required('VITE_CONVEX_URL')).replace(/\/$/, ''),
  )
}

export async function resolveWebhookUrl() {
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
