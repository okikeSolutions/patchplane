import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

const evidenceArtifactKind = v.union(
  v.literal('raw-trace'),
  v.literal('stdout'),
  v.literal('stderr'),
  v.literal('diff'),
  v.literal('test-report'),
  v.literal('screenshot'),
  v.literal('video'),
  v.literal('policy-result'),
  v.literal('trust-report'),
)

const candidatePatchSetStatus = v.union(
  v.literal('captured'),
  v.literal('empty'),
  v.literal('failed'),
)

const reviewRunKind = v.union(
  v.literal('test'),
  v.literal('lint'),
  v.literal('policy'),
  v.literal('manual'),
)

const reviewRunStatus = v.union(
  v.literal('queued'),
  v.literal('running'),
  v.literal('completed'),
  v.literal('failed'),
)

const reviewFindingSeverity = v.union(
  v.literal('info'),
  v.literal('warning'),
  v.literal('error'),
  v.literal('critical'),
)

const reviewFindingCategory = v.union(
  v.literal('test'),
  v.literal('lint'),
  v.literal('security'),
  v.literal('policy'),
  v.literal('quality'),
  v.literal('unknown'),
)

const decisionStatus = v.union(
  v.literal('approved'),
  v.literal('rejected'),
  v.literal('changes-requested'),
)

const policyDecisionStatus = v.union(
  v.literal('approved'),
  v.literal('rejected'),
  v.literal('changes-requested'),
  v.literal('manual-review'),
)

const publicationResultKind = v.union(
  v.literal('issue-comment'),
  v.literal('check-run'),
  v.literal('draft-pull-request'),
  v.literal('branch'),
)

const publicationResultStatus = v.union(
  v.literal('pending'),
  v.literal('published'),
  v.literal('failed'),
)

const provenanceEventStatus = v.union(
  v.literal('started'),
  v.literal('succeeded'),
  v.literal('failed'),
  v.literal('blocked'),
)

const sandboxPolicy = v.object({
  lifecycle: v.object({
    ephemeral: v.boolean(),
    retainAfterRun: v.boolean(),
    autoStopMinutes: v.optional(v.number()),
    autoArchiveMinutes: v.optional(v.number()),
    autoDeleteMinutes: v.optional(v.number()),
  }),
  network: v.object({
    blockAll: v.optional(v.boolean()),
    allowList: v.optional(v.string()),
  }),
  resources: v.object({
    cpu: v.optional(v.number()),
    memoryGb: v.optional(v.number()),
    diskGb: v.optional(v.number()),
  }),
  timeoutSeconds: v.optional(v.number()),
})

export default defineSchema({
  users: defineTable({
    authId: v.string(),
    email: v.string(),
    name: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    deletedAt: v.optional(v.number()),
    status: v.union(v.literal('active'), v.literal('deleted')),
    updatedAt: v.number(),
  }).index('by_auth_id', ['authId']),

  memberships: defineTable({
    workosMembershipId: v.string(),
    authId: v.string(),
    organizationId: v.string(),
    status: v.union(
      v.literal('active'),
      v.literal('inactive'),
      v.literal('pending'),
      v.literal('deleted'),
    ),
    role: v.string(),
    roles: v.array(v.string()),
    permissions: v.array(v.string()),
    deletedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index('by_workos_membership_id', ['workosMembershipId'])
    .index('by_auth_and_org', ['authId', 'organizationId']),

  promptRequests: defineTable({
    workspaceId: v.string(),
    actorId: v.string(),
    actorDisplayName: v.string(),
    traceId: v.optional(v.string()),
    source: v.union(
      v.literal('dev'),
      v.literal('app'),
      v.literal('external'),
    ),
    prompt: v.string(),
    externalRef: v.optional(
      v.object({
        provider: v.string(),
        deliveryId: v.string(),
        eventKind: v.string(),
        repositoryProvider: v.optional(v.string()),
        repositoryInstallationId: v.optional(v.string()),
        repositoryExternalId: v.optional(v.string()),
        repositoryOwner: v.optional(v.string()),
        repositoryName: v.optional(v.string()),
        repositoryFullName: v.optional(v.string()),
        issueExternalId: v.optional(v.string()),
        issueNumber: v.optional(v.number()),
        issueTitle: v.optional(v.string()),
        pullRequestExternalId: v.optional(v.string()),
        pullRequestNumber: v.optional(v.number()),
        pullRequestHeadSha: v.optional(v.string()),
        pullRequestHeadRef: v.optional(v.string()),
        pullRequestBaseRef: v.optional(v.string()),
        commentExternalId: v.optional(v.string()),
        url: v.optional(v.string()),
        senderProvider: v.optional(v.string()),
        senderExternalId: v.optional(v.string()),
        senderLogin: v.optional(v.string()),
      }),
    ),
    status: v.literal('created'),
    createdAt: v.number(),
  })
    .index('by_workspace', ['workspaceId'])
    .index('by_actor', ['actorId'])
    .index('by_trace', ['traceId']),

  externalWorkflowRefs: defineTable({
    provider: v.string(),
    workspaceId: v.optional(v.string()),
    deliveryId: v.string(),
    eventKind: v.string(),
    repositoryProvider: v.optional(v.string()),
    repositoryInstallationId: v.optional(v.string()),
    repositoryExternalId: v.optional(v.string()),
    repositoryOwner: v.optional(v.string()),
    repositoryName: v.optional(v.string()),
    repositoryFullName: v.optional(v.string()),
    issueExternalId: v.optional(v.string()),
    issueNumber: v.optional(v.number()),
    issueTitle: v.optional(v.string()),
    pullRequestExternalId: v.optional(v.string()),
    pullRequestNumber: v.optional(v.number()),
    pullRequestHeadSha: v.optional(v.string()),
    pullRequestHeadRef: v.optional(v.string()),
    pullRequestBaseRef: v.optional(v.string()),
    commentExternalId: v.optional(v.string()),
    url: v.optional(v.string()),
    senderProvider: v.optional(v.string()),
    senderExternalId: v.optional(v.string()),
    senderLogin: v.optional(v.string()),
    promptRequestId: v.id('promptRequests'),
    workflowRunId: v.id('workflowRuns'),
    createdAt: v.number(),
  })
    .index('by_delivery', ['provider', 'deliveryId'])
    .index('by_issue_event', [
      'provider',
      'repositoryExternalId',
      'issueExternalId',
      'eventKind',
    ])
    .index('by_comment', ['provider', 'commentExternalId'])
    .index('by_provider_and_repository_external_id', [
      'provider',
      'repositoryExternalId',
    ])
    .index('by_workspace_id_and_provider_and_repository_external_id', [
      'workspaceId',
      'provider',
      'repositoryExternalId',
    ]),

  runtimeEvents: defineTable({
    workflowRunId: v.id('workflowRuns'),
    provider: v.string(),
    type: v.string(),
    occurredAt: v.number(),
    summary: v.optional(v.string()),
    payloadJson: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    sourceSessionId: v.optional(v.string()),
    sourceCommandId: v.optional(v.string()),
    sourceStream: v.optional(v.union(v.literal('stdout'), v.literal('stderr'))),
    sourceLine: v.optional(v.number()),
    sourceOffset: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_workflow_run', ['workflowRunId'])
    .index('by_workflow_event_key', ['workflowRunId', 'idempotencyKey'])
    .index('by_type', ['provider', 'type']),

  runtimeSessions: defineTable({
    workflowRunId: v.id('workflowRuns'),
    provider: v.string(),
    sandboxId: v.string(),
    sessionId: v.string(),
    commandId: v.string(),
    status: v.union(
      v.literal('starting'),
      v.literal('running'),
      v.literal('completed'),
      v.literal('failed'),
      v.literal('cancelled'),
    ),
    startedAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_workflow_run', ['workflowRunId'])
    .index('by_status', ['status'])
    .index('by_sandbox_session', ['sandboxId', 'sessionId']),

  sandboxExecutions: defineTable({
    workflowRunId: v.id('workflowRuns'),
    provider: v.string(),
    sandboxId: v.string(),
    command: v.string(),
    status: v.union(v.literal('succeeded'), v.literal('failed')),
    exitCode: v.optional(v.number()),
    stdout: v.string(),
    stderr: v.optional(v.string()),
    policy: v.optional(sandboxPolicy),
    startedAt: v.number(),
    completedAt: v.number(),
    createdAt: v.number(),
  }).index('by_workflow_run', ['workflowRunId']),

  evidenceArtifacts: defineTable({
    workflowRunId: v.id('workflowRuns'),
    traceId: v.optional(v.string()),
    kind: evidenceArtifactKind,
    label: v.optional(v.string()),
    storageProvider: v.literal('cloudflare-r2'),
    storageKey: v.string(),
    contentType: v.string(),
    sizeBytes: v.number(),
    sha256: v.string(),
    retentionPolicy: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_workflow_run', ['workflowRunId'])
    .index('by_storage_key', ['storageProvider', 'storageKey'])
    .index('by_hash', ['sha256']),

  candidatePatchSets: defineTable({
    workflowRunId: v.id('workflowRuns'),
    status: candidatePatchSetStatus,
    baseRef: v.optional(v.string()),
    baseSha: v.optional(v.string()),
    headRef: v.optional(v.string()),
    headSha: v.optional(v.string()),
    diffArtifactId: v.optional(v.id('evidenceArtifacts')),
    summary: v.optional(v.string()),
    stats: v.optional(v.object({
      filesChanged: v.number(),
      additions: v.number(),
      deletions: v.number(),
    })),
    createdAt: v.number(),
  }).index('by_workflow_run', ['workflowRunId']),

  reviewRuns: defineTable({
    workflowRunId: v.id('workflowRuns'),
    sandboxExecutionId: v.optional(v.id('sandboxExecutions')),
    candidatePatchSetId: v.optional(v.id('candidatePatchSets')),
    kind: reviewRunKind,
    reviewer: v.string(),
    status: reviewRunStatus,
    summary: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_workflow_run', ['workflowRunId'])
    .index('by_status', ['status']),

  reviewFindings: defineTable({
    workflowRunId: v.id('workflowRuns'),
    reviewRunId: v.optional(v.id('reviewRuns')),
    severity: reviewFindingSeverity,
    category: reviewFindingCategory,
    message: v.string(),
    path: v.optional(v.string()),
    startLine: v.optional(v.number()),
    endLine: v.optional(v.number()),
    evidenceArtifactId: v.optional(v.id('evidenceArtifacts')),
    createdAt: v.number(),
  })
    .index('by_workflow_run', ['workflowRunId'])
    .index('by_review_run', ['reviewRunId']),

  policyDecisions: defineTable({
    workflowRunId: v.id('workflowRuns'),
    reviewRunId: v.optional(v.id('reviewRuns')),
    status: policyDecisionStatus,
    summary: v.string(),
    reason: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_workflow_run', ['workflowRunId']),

  humanDecisions: defineTable({
    workflowRunId: v.id('workflowRuns'),
    sandboxExecutionId: v.optional(v.id('sandboxExecutions')),
    candidatePatchSetId: v.optional(v.id('candidatePatchSets')),
    reviewRunId: v.optional(v.id('reviewRuns')),
    policyDecisionId: v.optional(v.id('policyDecisions')),
    actorId: v.string(),
    status: decisionStatus,
    comment: v.string(),
    decidedAt: v.number(),
    idempotencyKey: v.optional(v.string()),
  })
    .index('by_workflow_run', ['workflowRunId'])
    .index('by_actor', ['actorId'])
    .index('by_workflow_decision_key', ['workflowRunId', 'idempotencyKey']),

  publicationResults: defineTable({
    workflowRunId: v.id('workflowRuns'),
    provider: v.string(),
    kind: publicationResultKind,
    status: publicationResultStatus,
    externalId: v.optional(v.string()),
    url: v.optional(v.string()),
    summary: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    idempotencyKey: v.optional(v.string()),
  })
    .index('by_workflow_run', ['workflowRunId'])
    .index('by_provider_external', ['provider', 'externalId'])
    .index('by_workflow_publication_key', ['workflowRunId', 'idempotencyKey']),

  provenanceEvents: defineTable({
    workflowRunId: v.id('workflowRuns'),
    traceId: v.string(),
    parentEventId: v.optional(v.string()),
    sequence: v.number(),
    type: v.string(),
    operation: v.string(),
    pluginName: v.optional(v.string()),
    status: provenanceEventStatus,
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    summary: v.optional(v.string()),
    artifactRefs: v.array(v.string()),
    errorCategory: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
  })
    .index('by_workflow_run', ['workflowRunId'])
    .index('by_workflow_sequence', ['workflowRunId', 'sequence'])
    .index('by_trace', ['traceId'])
    .index('by_workflow_event_key', ['workflowRunId', 'idempotencyKey']),

  githubConnectionIntents: defineTable({
    state: v.string(),
    workspaceId: v.string(),
    actorId: v.string(),
    returnPathname: v.optional(v.string()),
    expiresAt: v.number(),
    consumedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_state', ['state'])
    .index('by_workspace', ['workspaceId']),

  connectedRepositoryAccounts: defineTable({
    provider: v.string(),
    workspaceId: v.string(),
    installationId: v.string(),
    accountExternalId: v.string(),
    accountLogin: v.string(),
    accountType: v.optional(v.string()),
    status: v.union(
      v.literal('active'),
      v.literal('suspended'),
      v.literal('removed'),
      v.literal('reconnect_required'),
    ),
    connectedByActorId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_workspace', ['workspaceId'])
    .index('by_provider_installation', ['provider', 'installationId'])
    .index('by_provider_account', ['provider', 'accountExternalId']),

  connectedRepositories: defineTable({
    provider: v.string(),
    workspaceId: v.string(),
    installationId: v.string(),
    repositoryExternalId: v.string(),
    repositoryOwner: v.string(),
    repositoryName: v.string(),
    repositoryFullName: v.string(),
    private: v.boolean(),
    selected: v.boolean(),
    permissionsJson: v.optional(v.string()),
    status: v.union(
      v.literal('active'),
      v.literal('suspended'),
      v.literal('removed'),
      v.literal('reconnect_required'),
    ),
    connectedByActorId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_workspace', ['workspaceId'])
    .index('by_provider_repository', ['provider', 'repositoryExternalId'])
    .index('by_provider_installation', ['provider', 'installationId'])
    .index('by_workspace_full_name', ['workspaceId', 'repositoryFullName']),

  workflowRuns: defineTable({
    promptRequestId: v.id('promptRequests'),
    workspaceId: v.string(),
    traceId: v.optional(v.string()),
    status: v.union(
      v.literal('queued'),
      v.literal('running'),
      v.literal('reviewed'),
    ),
    createdAt: v.number(),
  })
    .index('by_prompt_request', ['promptRequestId'])
    .index('by_workspace', ['workspaceId'])
    .index('by_trace', ['traceId']),
})
