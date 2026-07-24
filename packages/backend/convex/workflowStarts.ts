import type { UserIdentity } from 'convex/server'
import type { Id } from './_generated/dataModel'
import { ConvexError, v } from 'convex/values'
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'

function workOSOrganizationId(identity: UserIdentity) {
  const value =
    identity.organizationId ??
    identity.orgId ??
    identity.organization_id ??
    identity.org_id

  return typeof value === 'string' && value.length > 0 ? value : null
}

function requireWorkOSWorkspace(identity: UserIdentity, workspaceId: string) {
  const organizationId = workOSOrganizationId(identity)

  if (organizationId === null) {
    throw new ConvexError('Active WorkOS organization required')
  }

  if (workspaceId !== `workos:${organizationId}`) {
    throw new ConvexError('Workspace mismatch')
  }
}

async function requireWorkOSIdentity(ctx: {
  auth: { getUserIdentity(): Promise<UserIdentity | null> }
}) {
  const identity = await ctx.auth.getUserIdentity()

  if (identity === null) {
    throw new ConvexError('Authentication required')
  }

  return identity
}

function workspaceOrganizationId(workspaceId: string) {
  return workspaceId.startsWith('workos:')
    ? workspaceId.slice('workos:'.length)
    : null
}

async function requireMembershipPermission(
  ctx: QueryCtx | MutationCtx,
  identity: UserIdentity,
  workspaceId: string,
  permission: string,
) {
  const organizationId = workspaceOrganizationId(workspaceId)

  if (organizationId === null) {
    throw new ConvexError('WorkOS workspace required')
  }

  const memberships = await ctx.db
    .query('memberships')
    .withIndex('by_auth_and_org', (q) =>
      q.eq('authId', identity.subject).eq('organizationId', organizationId),
    )
    .collect()
  const activeMemberships = memberships.filter(
    (membership) => membership.status === 'active',
  )

  if (activeMemberships.length === 0) {
    throw new ConvexError('Active membership required')
  }

  const membershipWithPermission = activeMemberships.find((membership) =>
    membership.permissions.includes(permission),
  )

  if (membershipWithPermission === undefined) {
    throw new ConvexError('Permission required')
  }

  return membershipWithPermission
}

const externalWorkflowRefArg = v.object({
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
})

const workflowStartArgs = {
  workspaceId: v.string(),
  actorId: v.string(),
  actorDisplayName: v.string(),
  source: v.union(
    v.literal('dev'),
    v.literal('app'),
    v.literal('external'),
  ),
  traceId: v.string(),
  prompt: v.string(),
}

const sandboxPolicyArg = v.object({
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

function sortedByNumber<A>(
  items: ReadonlyArray<A>,
  value: (item: A) => number,
): Array<A> {
  return items.reduce<Array<A>>((sorted, item) => {
    const insertAt = sorted.findIndex((candidate) => value(item) < value(candidate))

    if (insertAt === -1) {
      return [...sorted, item]
    }

    return [
      ...sorted.slice(0, insertAt),
      item,
      ...sorted.slice(insertAt),
    ]
  }, [])
}

const evidenceArtifactKindArg = v.union(
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

const evidenceArtifactReturn = v.object({
  id: v.string(),
  workflowRunId: v.string(),
  traceId: v.optional(v.string()),
  kind: evidenceArtifactKindArg,
  label: v.optional(v.string()),
  storageProvider: v.literal('cloudflare-r2'),
  storageKey: v.string(),
  contentType: v.string(),
  sizeBytes: v.number(),
  sha256: v.string(),
  retentionPolicy: v.optional(v.string()),
  createdAt: v.number(),
})

const candidatePatchSetStatusArg = v.union(
  v.literal('captured'),
  v.literal('empty'),
  v.literal('failed'),
)

const candidatePatchSetStatsArg = v.object({
  filesChanged: v.number(),
  additions: v.number(),
  deletions: v.number(),
})

const candidatePatchSetReturn = v.object({
  id: v.string(),
  workflowRunId: v.string(),
  status: candidatePatchSetStatusArg,
  baseRef: v.optional(v.string()),
  baseSha: v.optional(v.string()),
  headRef: v.optional(v.string()),
  headSha: v.optional(v.string()),
  diffArtifactId: v.optional(v.string()),
  summary: v.optional(v.string()),
  stats: v.optional(candidatePatchSetStatsArg),
  createdAt: v.number(),
})

const reviewRunKindArg = v.union(
  v.literal('test'),
  v.literal('lint'),
  v.literal('policy'),
  v.literal('manual'),
)

const reviewRunStatusArg = v.union(
  v.literal('queued'),
  v.literal('running'),
  v.literal('completed'),
  v.literal('failed'),
)

const reviewRunReturn = v.object({
  id: v.string(),
  workflowRunId: v.string(),
  sandboxExecutionId: v.optional(v.string()),
  candidatePatchSetId: v.optional(v.string()),
  kind: reviewRunKindArg,
  reviewer: v.string(),
  status: reviewRunStatusArg,
  summary: v.optional(v.string()),
  startedAt: v.number(),
  completedAt: v.optional(v.number()),
  createdAt: v.number(),
})

const reviewFindingSeverityArg = v.union(
  v.literal('info'),
  v.literal('warning'),
  v.literal('error'),
  v.literal('critical'),
)

const reviewFindingCategoryArg = v.union(
  v.literal('test'),
  v.literal('lint'),
  v.literal('security'),
  v.literal('policy'),
  v.literal('quality'),
  v.literal('unknown'),
)

const reviewFindingReturn = v.object({
  id: v.string(),
  workflowRunId: v.string(),
  reviewRunId: v.optional(v.string()),
  severity: reviewFindingSeverityArg,
  category: reviewFindingCategoryArg,
  message: v.string(),
  path: v.optional(v.string()),
  startLine: v.optional(v.number()),
  endLine: v.optional(v.number()),
  evidenceArtifactId: v.optional(v.string()),
  createdAt: v.number(),
})

const decisionStatusArg = v.union(
  v.literal('approved'),
  v.literal('rejected'),
  v.literal('changes-requested'),
)

const policyDecisionStatusArg = v.union(
  v.literal('approved'),
  v.literal('rejected'),
  v.literal('changes-requested'),
  v.literal('manual-review'),
)

const policyDecisionReturn = v.object({
  id: v.string(),
  workflowRunId: v.string(),
  reviewRunId: v.optional(v.string()),
  status: policyDecisionStatusArg,
  summary: v.string(),
  reason: v.optional(v.string()),
  createdAt: v.number(),
})

const humanDecisionReturn = v.object({
  id: v.string(),
  workflowRunId: v.string(),
  sandboxExecutionId: v.optional(v.string()),
  candidatePatchSetId: v.optional(v.string()),
  reviewRunId: v.optional(v.string()),
  policyDecisionId: v.optional(v.string()),
  actorId: v.string(),
  status: decisionStatusArg,
  comment: v.string(),
  decidedAt: v.number(),
  idempotencyKey: v.optional(v.string()),
})

const publicationResultKindArg = v.union(
  v.literal('issue-comment'),
  v.literal('check-run'),
  v.literal('draft-pull-request'),
  v.literal('branch'),
)

const publicationResultStatusArg = v.union(
  v.literal('pending'),
  v.literal('published'),
  v.literal('failed'),
)

const publicationResultReturn = v.object({
  id: v.string(),
  workflowRunId: v.string(),
  provider: v.string(),
  kind: publicationResultKindArg,
  status: publicationResultStatusArg,
  externalId: v.optional(v.string()),
  url: v.optional(v.string()),
  summary: v.optional(v.string()),
  error: v.optional(v.string()),
  createdAt: v.number(),
  idempotencyKey: v.optional(v.string()),
})

const provenanceEventStatusArg = v.union(
  v.literal('started'),
  v.literal('succeeded'),
  v.literal('failed'),
  v.literal('blocked'),
)

const provenanceEventReturn = v.object({
  id: v.string(),
  workflowRunId: v.string(),
  traceId: v.string(),
  parentEventId: v.optional(v.string()),
  sequence: v.number(),
  type: v.string(),
  operation: v.string(),
  pluginName: v.optional(v.string()),
  status: provenanceEventStatusArg,
  startedAt: v.number(),
  completedAt: v.optional(v.number()),
  summary: v.optional(v.string()),
  artifactRefs: v.array(v.string()),
  errorCategory: v.optional(v.string()),
  idempotencyKey: v.optional(v.string()),
})

const runtimeEventReturn = v.object({
  id: v.string(),
  workflowRunId: v.string(),
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
})

const runtimeSessionStatusArg = v.union(
  v.literal('starting'),
  v.literal('running'),
  v.literal('completed'),
  v.literal('failed'),
  v.literal('cancelled'),
)

const runtimeSessionReturn = v.object({
  id: v.string(),
  workflowRunId: v.string(),
  provider: v.string(),
  sandboxId: v.string(),
  sessionId: v.string(),
  commandId: v.string(),
  status: runtimeSessionStatusArg,
  startedAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
})

const sandboxExecutionReturn = v.object({
  id: v.string(),
  workflowRunId: v.string(),
  provider: v.string(),
  sandboxId: v.string(),
  command: v.string(),
  status: v.union(v.literal('succeeded'), v.literal('failed')),
  exitCode: v.optional(v.number()),
  stdout: v.string(),
  stderr: v.optional(v.string()),
  policy: v.optional(sandboxPolicyArg),
  startedAt: v.number(),
  completedAt: v.number(),
})

const workflowDetailReturn = v.object({
  promptRequest: v.object({
    id: v.string(),
    workspaceId: v.string(),
    actorId: v.string(),
    traceId: v.string(),
    source: v.union(
      v.literal('dev'),
      v.literal('app'),
      v.literal('external'),
    ),
    prompt: v.string(),
    externalRef: v.optional(externalWorkflowRefArg),
    status: v.literal('created'),
    createdAt: v.number(),
  }),
  workflowRun: v.object({
    id: v.string(),
    promptRequestId: v.string(),
    workspaceId: v.string(),
    traceId: v.string(),
    status: v.union(
      v.literal('queued'),
      v.literal('running'),
      v.literal('reviewed'),
    ),
    createdAt: v.number(),
  }),
  runtimeEvents: v.array(runtimeEventReturn),
  runtimeSessions: v.array(runtimeSessionReturn),
  sandboxExecutions: v.array(sandboxExecutionReturn),
  evidenceArtifacts: v.array(evidenceArtifactReturn),
  candidatePatchSets: v.array(candidatePatchSetReturn),
  reviewRuns: v.array(reviewRunReturn),
  reviewFindings: v.array(reviewFindingReturn),
  policyDecisions: v.array(policyDecisionReturn),
  humanDecisions: v.array(humanDecisionReturn),
  publicationResults: v.array(publicationResultReturn),
  provenanceEvents: v.array(provenanceEventReturn),
})

const workflowStartReturn = v.object({
  promptRequest: v.object({
    id: v.string(),
    workspaceId: v.string(),
    actorId: v.string(),
    traceId: v.string(),
    source: v.union(
      v.literal('dev'),
      v.literal('app'),
      v.literal('external'),
    ),
    prompt: v.string(),
    externalRef: v.optional(externalWorkflowRefArg),
    status: v.literal('created'),
    createdAt: v.number(),
  }),
  workflowRun: v.object({
    id: v.string(),
    promptRequestId: v.string(),
    workspaceId: v.string(),
    traceId: v.string(),
    status: v.union(
      v.literal('queued'),
      v.literal('running'),
      v.literal('reviewed'),
    ),
    createdAt: v.number(),
  }),
})

const decisionPublicationReplayFixtureReturn = v.object({
  workflowStart: workflowStartReturn,
  humanDecision: humanDecisionReturn,
  candidateHeadSha: v.optional(v.string()),
  publicationResults: v.array(publicationResultReturn),
})

async function createWorkflowStartRecord(
  ctx: MutationCtx,
  args: {
    workspaceId: string
    actorId: string
    actorDisplayName: string
    source: 'dev' | 'app' | 'external'
    traceId: string
    prompt: string
    externalRef?: {
      provider: string
      deliveryId: string
      eventKind: string
      repositoryProvider?: string
      repositoryInstallationId?: string
      repositoryExternalId?: string
      repositoryOwner?: string
      repositoryName?: string
      repositoryFullName?: string
      issueExternalId?: string
      issueNumber?: number
      issueTitle?: string
      pullRequestExternalId?: string
      pullRequestNumber?: number
      pullRequestHeadSha?: string
      pullRequestHeadRef?: string
      pullRequestBaseRef?: string
      commentExternalId?: string
      url?: string
      senderProvider?: string
      senderExternalId?: string
      senderLogin?: string
    }
  },
) {
    const createdAt = Date.now()
    const promptRequestStatus = 'created' as const
    const workflowRunStatus = 'queued' as const

    const promptRequestId = await ctx.db.insert('promptRequests', {
      workspaceId: args.workspaceId,
      actorId: args.actorId,
      actorDisplayName: args.actorDisplayName,
      traceId: args.traceId,
      source: args.source,
      prompt: args.prompt,
      ...(args.externalRef === undefined ? {} : { externalRef: args.externalRef }),
      status: promptRequestStatus,
      createdAt,
    })

    const workflowRunId = await ctx.db.insert('workflowRuns', {
      promptRequestId,
      workspaceId: args.workspaceId,
      traceId: args.traceId,
      status: workflowRunStatus,
      createdAt,
    })

    await insertProvenanceEvent(ctx, {
      workflowRunId,
      traceId: args.traceId,
      type: 'workflow-start',
      operation: 'workflowStarts.create',
      status: 'succeeded',
      startedAt: createdAt,
      completedAt: createdAt,
      summary: args.externalRef?.repositoryFullName === undefined
        ? `Prompt recorded from ${args.source} by ${args.actorId}.`
        : `Prompt recorded from ${args.source} by ${args.actorId} for ${args.externalRef.repositoryFullName}.`,
      artifactRefs: [String(promptRequestId)],
      idempotencyKey: `${String(workflowRunId)}:workflow-start`,
    })

    console.log('workflowStarts:create succeeded', {
      traceId: args.traceId,
      promptRequestId,
      workflowRunId,
    })

    return {
      promptRequest: {
        id: promptRequestId,
        workspaceId: args.workspaceId,
        actorId: args.actorId,
        traceId: args.traceId,
        source: args.source,
        prompt: args.prompt,
        ...(args.externalRef === undefined ? {} : { externalRef: args.externalRef }),
        status: promptRequestStatus,
        createdAt,
      },
      workflowRun: {
        id: workflowRunId,
        promptRequestId,
        workspaceId: args.workspaceId,
        traceId: args.traceId,
        status: workflowRunStatus,
        createdAt,
      },
    }
}

async function workflowStartFromIds(
  ctx: MutationCtx,
  ids: {
    promptRequestId: Id<'promptRequests'>
    workflowRunId: Id<'workflowRuns'>
  },
) {
  const promptRequest = await ctx.db.get('promptRequests', ids.promptRequestId)
  const workflowRun = await ctx.db.get('workflowRuns', ids.workflowRunId)

  if (promptRequest === null || workflowRun === null) {
    throw new ConvexError('External workflow reference is missing workflow records')
  }

  return {
    promptRequest: {
      id: promptRequest['_id'],
      workspaceId: promptRequest.workspaceId,
      actorId: promptRequest.actorId,
      traceId: promptRequest.traceId ?? 'legacy',
      source: promptRequest.source,
      prompt: promptRequest.prompt,
      ...(promptRequest.externalRef === undefined
        ? {}
        : { externalRef: promptRequest.externalRef }),
      status: promptRequest.status,
      createdAt: promptRequest.createdAt,
    },
    workflowRun: {
      id: workflowRun['_id'],
      promptRequestId: workflowRun.promptRequestId,
      workspaceId: workflowRun.workspaceId,
      traceId: workflowRun.traceId ?? 'legacy',
      status: workflowRun.status,
      createdAt: workflowRun.createdAt,
    },
  }
}

async function existingExternalWorkflowRef(ctx: MutationCtx, externalRef: {
  provider: string
  deliveryId: string
  eventKind: string
  repositoryExternalId?: string
  issueExternalId?: string
  commentExternalId?: string
}) {
  if (externalRef.commentExternalId !== undefined) {
    const byComment = await ctx.db
      .query('externalWorkflowRefs')
      .withIndex('by_comment', (q) =>
        q
          .eq('provider', externalRef.provider)
          .eq('commentExternalId', externalRef.commentExternalId),
      )
      .unique()

    if (byComment !== null) {
      return byComment
    }
  }

  if (
    externalRef.repositoryExternalId !== undefined &&
    externalRef.issueExternalId !== undefined
  ) {
    const byIssueEvent = await ctx.db
      .query('externalWorkflowRefs')
      .withIndex('by_issue_event', (q) =>
        q
          .eq('provider', externalRef.provider)
          .eq('repositoryExternalId', externalRef.repositoryExternalId)
          .eq('issueExternalId', externalRef.issueExternalId)
          .eq('eventKind', externalRef.eventKind),
      )
      .unique()

    if (byIssueEvent !== null) {
      return byIssueEvent
    }
  }

  return ctx.db
    .query('externalWorkflowRefs')
    .withIndex('by_delivery', (q) =>
      q.eq('provider', externalRef.provider).eq('deliveryId', externalRef.deliveryId),
    )
    .unique()
}

function requireSystemIngestionSecret(secret: string) {
  const expected = process.env.PATCHPLANE_SYSTEM_INGESTION_SECRET

  if (expected === undefined || expected.length === 0 || secret !== expected) {
    throw new ConvexError('System ingestion secret required')
  }
}

async function requireWorkflowRun(ctx: QueryCtx | MutationCtx, workflowRunId: Id<'workflowRuns'>) {
  const workflowRun = await ctx.db.get('workflowRuns', workflowRunId)
  if (workflowRun === null) {
    throw new ConvexError('Workflow run not found')
  }
  return workflowRun
}

async function requireReviewRunForWorkflow(
  ctx: QueryCtx | MutationCtx,
  reviewRunId: Id<'reviewRuns'>,
  workflowRunId: Id<'workflowRuns'>,
) {
  const reviewRun = await ctx.db.get('reviewRuns', reviewRunId)
  if (reviewRun === null || reviewRun.workflowRunId !== workflowRunId) {
    throw new ConvexError('Review run not found')
  }
  return reviewRun
}

async function requireEvidenceArtifactForWorkflow(
  ctx: QueryCtx | MutationCtx,
  artifactId: Id<'evidenceArtifacts'>,
  workflowRunId: Id<'workflowRuns'>,
) {
  const artifact = await ctx.db.get('evidenceArtifacts', artifactId)
  if (artifact === null || artifact.workflowRunId !== workflowRunId) {
    throw new ConvexError('Evidence artifact not found')
  }
  return artifact
}

async function insertProvenanceEvent(
  ctx: MutationCtx,
  input: {
    workflowRunId: Id<'workflowRuns'>
    traceId: string
    parentEventId?: string | undefined
    type: string
    operation: string
    pluginName?: string | undefined
    status: 'started' | 'succeeded' | 'failed' | 'blocked'
    startedAt: number
    completedAt?: number | undefined
    summary?: string | undefined
    artifactRefs?: ReadonlyArray<string> | undefined
    errorCategory?: string | undefined
    idempotencyKey?: string | undefined
  },
) {
  if (input.idempotencyKey !== undefined) {
    const existing = await ctx.db
      .query('provenanceEvents')
      .withIndex('by_workflow_event_key', (q) =>
        q
          .eq('workflowRunId', input.workflowRunId)
          .eq('idempotencyKey', input.idempotencyKey),
      )
      .unique()

    if (existing !== null) {
      const updated = {
        traceId: input.traceId,
        parentEventId: input.parentEventId,
        type: input.type,
        operation: input.operation,
        pluginName: input.pluginName,
        status: input.status,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        summary: input.summary,
        artifactRefs: [...(input.artifactRefs ?? [])],
        errorCategory: input.errorCategory,
        idempotencyKey: input.idempotencyKey,
      }
      await ctx.db.patch('provenanceEvents', existing._id, updated)
      return {
        id: existing._id,
        workflowRunId: existing.workflowRunId,
        traceId: updated.traceId,
        ...(updated.parentEventId === undefined ? {} : { parentEventId: updated.parentEventId }),
        sequence: existing.sequence,
        type: updated.type,
        operation: updated.operation,
        ...(updated.pluginName === undefined ? {} : { pluginName: updated.pluginName }),
        status: updated.status,
        startedAt: updated.startedAt,
        ...(updated.completedAt === undefined ? {} : { completedAt: updated.completedAt }),
        ...(updated.summary === undefined ? {} : { summary: updated.summary }),
        artifactRefs: updated.artifactRefs,
        ...(updated.errorCategory === undefined ? {} : { errorCategory: updated.errorCategory }),
        idempotencyKey: updated.idempotencyKey,
      }
    }
  }

  const latest = await ctx.db
    .query('provenanceEvents')
    .withIndex('by_workflow_sequence', (q) => q.eq('workflowRunId', input.workflowRunId))
    .order('desc')
    .first()
  const sequence = latest === null ? 1 : latest.sequence + 1
  const event = {
    workflowRunId: input.workflowRunId,
    traceId: input.traceId,
    ...(input.parentEventId === undefined ? {} : { parentEventId: input.parentEventId }),
    sequence,
    type: input.type,
    operation: input.operation,
    ...(input.pluginName === undefined ? {} : { pluginName: input.pluginName }),
    status: input.status,
    startedAt: input.startedAt,
    ...(input.completedAt === undefined ? {} : { completedAt: input.completedAt }),
    ...(input.summary === undefined ? {} : { summary: input.summary }),
    artifactRefs: [...(input.artifactRefs ?? [])],
    ...(input.errorCategory === undefined ? {} : { errorCategory: input.errorCategory }),
    ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
  }
  const id = await ctx.db.insert('provenanceEvents', event)

  return { id, ...event }
}

export const create = mutation({
  args: workflowStartArgs,
  returns: workflowStartReturn,
  handler: async (ctx, args) => {
    const identity = await requireWorkOSIdentity(ctx)
    requireWorkOSWorkspace(identity, args.workspaceId)

    if (args.actorId !== `workos:${identity.subject}`) {
      throw new ConvexError('Actor mismatch')
    }

    if (args.source !== 'app') {
      throw new ConvexError('App workflow source required')
    }

    await requireMembershipPermission(
      ctx,
      identity,
      args.workspaceId,
      'prompt:create',
    )

    return createWorkflowStartRecord(ctx, args)
  },
})

export const createFromExternalIntake = mutation({
  args: {
    systemSecret: v.string(),
    workspaceId: v.string(),
    actorId: v.string(),
    actorDisplayName: v.string(),
    source: v.literal('external'),
    traceId: v.string(),
    prompt: v.string(),
    externalRef: externalWorkflowRefArg,
  },
  returns: workflowStartReturn,
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)

    const existing = await existingExternalWorkflowRef(ctx, args.externalRef)

    if (existing !== null) {
      return workflowStartFromIds(ctx, {
        promptRequestId: existing.promptRequestId,
        workflowRunId: existing.workflowRunId,
      })
    }

    const workflowStart = await createWorkflowStartRecord(ctx, {
      workspaceId: args.workspaceId,
      actorId: args.actorId,
      actorDisplayName: args.actorDisplayName,
      source: args.source,
      traceId: args.traceId,
      prompt: args.prompt,
      externalRef: args.externalRef,
    })

    await ctx.db.insert('externalWorkflowRefs', {
      ...args.externalRef,
      workspaceId: args.workspaceId,
      promptRequestId: workflowStart.promptRequest.id,
      workflowRunId: workflowStart.workflowRun.id,
      createdAt: workflowStart.promptRequest.createdAt,
    })

    return workflowStart
  },
})

export const recordRuntimeEvents = mutation({
  args: {
    systemSecret: v.string(),
    events: v.array(v.object({
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
    })),
  },
  returns: v.array(runtimeEventReturn),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const rows = []

    for (const event of args.events) {
      const workflowRun = await ctx.db.get('workflowRuns', event.workflowRunId)
      if (workflowRun === null) {
        throw new ConvexError('Workflow run not found')
      }

      if (event.idempotencyKey !== undefined) {
        const existing = await ctx.db
          .query('runtimeEvents')
          .withIndex('by_workflow_event_key', (q) =>
            q.eq('workflowRunId', event.workflowRunId).eq('idempotencyKey', event.idempotencyKey)
          )
          .unique()
        if (existing !== null) {
          rows.push({
            id: existing['_id'],
            workflowRunId: existing.workflowRunId,
            provider: existing.provider,
            type: existing.type,
            occurredAt: existing.occurredAt,
            ...(existing.summary === undefined ? {} : { summary: existing.summary }),
            ...(existing.payloadJson === undefined ? {} : { payloadJson: existing.payloadJson }),
            ...(existing.idempotencyKey === undefined ? {} : { idempotencyKey: existing.idempotencyKey }),
            ...(existing.sourceSessionId === undefined ? {} : { sourceSessionId: existing.sourceSessionId }),
            ...(existing.sourceCommandId === undefined ? {} : { sourceCommandId: existing.sourceCommandId }),
            ...(existing.sourceStream === undefined ? {} : { sourceStream: existing.sourceStream }),
            ...(existing.sourceLine === undefined ? {} : { sourceLine: existing.sourceLine }),
            ...(existing.sourceOffset === undefined ? {} : { sourceOffset: existing.sourceOffset }),
          })
          continue
        }
      }

      const id = await ctx.db.insert('runtimeEvents', {
        ...event,
        createdAt: Date.now(),
      })
      await insertProvenanceEvent(ctx, {
        workflowRunId: event.workflowRunId,
        traceId: workflowRun.traceId ?? 'legacy',
        type: 'runtime-event',
        operation: event.type,
        pluginName: event.provider,
        status: 'succeeded',
        startedAt: event.occurredAt,
        completedAt: event.occurredAt,
        summary: event.summary,
        artifactRefs: [String(id)],
        idempotencyKey: event.idempotencyKey === undefined
          ? `${String(id)}:runtime-event`
          : `${event.idempotencyKey}:provenance`,
      })
      rows.push({ id, ...event })
    }

    return rows
  },
})

export const recordRuntimeSessionStarted = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    provider: v.string(),
    sandboxId: v.string(),
    sessionId: v.string(),
    commandId: v.string(),
    startedAt: v.number(),
  },
  returns: runtimeSessionReturn,
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const workflowRun = await ctx.db.get('workflowRuns', args.workflowRunId)
    if (workflowRun === null) {
      throw new ConvexError('Workflow run not found')
    }

    const now = Date.now()
    const id = await ctx.db.insert('runtimeSessions', {
      workflowRunId: args.workflowRunId,
      provider: args.provider,
      sandboxId: args.sandboxId,
      sessionId: args.sessionId,
      commandId: args.commandId,
      status: 'running' as const,
      startedAt: args.startedAt,
      updatedAt: now,
      createdAt: now,
    })

    if (workflowRun.status === 'queued') {
      await ctx.db.patch('workflowRuns', args.workflowRunId, { status: 'running' })
    }

    await insertProvenanceEvent(ctx, {
      workflowRunId: args.workflowRunId,
      traceId: workflowRun.traceId ?? 'legacy',
      type: 'runtime-session',
      operation: 'runtimeSession.started',
      pluginName: args.provider,
      status: 'started',
      startedAt: args.startedAt,
      summary: `Runtime session ${args.sessionId} started in sandbox ${args.sandboxId}.`,
      artifactRefs: [String(id)],
      idempotencyKey: `${args.sessionId}:${args.commandId}:started`,
    })

    return {
      id,
      workflowRunId: args.workflowRunId,
      provider: args.provider,
      sandboxId: args.sandboxId,
      sessionId: args.sessionId,
      commandId: args.commandId,
      status: 'running' as const,
      startedAt: args.startedAt,
      updatedAt: now,
    }
  },
})

export const markRuntimeSessionStatus = mutation({
  args: {
    systemSecret: v.string(),
    runtimeSessionId: v.id('runtimeSessions'),
    status: runtimeSessionStatusArg,
    completedAt: v.optional(v.number()),
  },
  returns: runtimeSessionReturn,
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const runtimeSession = await ctx.db.get('runtimeSessions', args.runtimeSessionId)
    if (runtimeSession === null) {
      throw new ConvexError('Runtime session not found')
    }

    const updatedAt = Date.now()
    const workflowRun = await requireWorkflowRun(ctx, runtimeSession.workflowRunId)
    await ctx.db.patch('runtimeSessions', args.runtimeSessionId, {
      status: args.status,
      updatedAt,
      ...(args.completedAt === undefined ? {} : { completedAt: args.completedAt }),
    })

    await insertProvenanceEvent(ctx, {
      workflowRunId: runtimeSession.workflowRunId,
      traceId: workflowRun.traceId ?? 'legacy',
      type: 'runtime-session',
      operation: 'runtimeSession.status',
      pluginName: runtimeSession.provider,
      status: args.status === 'completed' ? 'succeeded' : args.status === 'running' ? 'started' : args.status === 'cancelled' ? 'blocked' : 'failed',
      startedAt: updatedAt,
      completedAt: args.completedAt ?? updatedAt,
      summary: `Runtime session ${runtimeSession.sessionId} marked ${args.status}.`,
      artifactRefs: [String(args.runtimeSessionId)],
      idempotencyKey: `${String(args.runtimeSessionId)}:${args.status}:${args.completedAt ?? updatedAt}`,
    })

    return {
      id: args.runtimeSessionId,
      workflowRunId: runtimeSession.workflowRunId,
      provider: runtimeSession.provider,
      sandboxId: runtimeSession.sandboxId,
      sessionId: runtimeSession.sessionId,
      commandId: runtimeSession.commandId,
      status: args.status,
      startedAt: runtimeSession.startedAt,
      updatedAt,
      ...(args.completedAt === undefined ? runtimeSession.completedAt === undefined ? {} : { completedAt: runtimeSession.completedAt } : { completedAt: args.completedAt }),
    }
  },
})

export const getActiveRuntimeSession = query({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
  },
  returns: v.union(runtimeSessionReturn, v.null()),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const sessions = await ctx.db
      .query('runtimeSessions')
      .withIndex('by_workflow_run', (q) => q.eq('workflowRunId', args.workflowRunId))
      .collect()

    const active = sortedByNumber(
      sessions.filter((session) => session.status === 'starting' || session.status === 'running'),
      (session) => session.updatedAt,
    ).at(-1)

    if (active === undefined) return null
    return {
      id: active['_id'],
      workflowRunId: active.workflowRunId,
      provider: active.provider,
      sandboxId: active.sandboxId,
      sessionId: active.sessionId,
      commandId: active.commandId,
      status: active.status,
      startedAt: active.startedAt,
      updatedAt: active.updatedAt,
      ...(active.completedAt === undefined ? {} : { completedAt: active.completedAt }),
    }
  },
})

export const getEvidenceArtifact = query({
  args: {
    artifactId: v.id('evidenceArtifacts'),
    workflowRunId: v.optional(v.id('workflowRuns')),
    systemSecret: v.optional(v.string()),
  },
  returns: v.union(evidenceArtifactReturn, v.null()),
  handler: async (ctx, args) => {
    const artifact = await ctx.db.get('evidenceArtifacts', args.artifactId)
    if (artifact === null) return null

    if (args.workflowRunId !== undefined && artifact.workflowRunId !== args.workflowRunId) {
      return null
    }

    const workflowRun = await ctx.db.get('workflowRuns', artifact.workflowRunId)
    if (workflowRun === null) {
      throw new ConvexError('Workflow run not found')
    }

    if (args.systemSecret !== undefined) {
      requireSystemIngestionSecret(args.systemSecret)
    } else {
      const identity = await requireWorkOSIdentity(ctx)
      requireWorkOSWorkspace(identity, workflowRun.workspaceId)
      await requireMembershipPermission(
        ctx,
        identity,
        workflowRun.workspaceId,
        'workspace:view',
      )
    }

    return {
      id: artifact['_id'],
      workflowRunId: artifact.workflowRunId,
      ...(artifact.traceId === undefined ? {} : { traceId: artifact.traceId }),
      kind: artifact.kind,
      ...(artifact.label === undefined ? {} : { label: artifact.label }),
      storageProvider: artifact.storageProvider,
      storageKey: artifact.storageKey,
      contentType: artifact.contentType,
      sizeBytes: artifact.sizeBytes,
      sha256: artifact.sha256,
      ...(artifact.retentionPolicy === undefined ? {} : { retentionPolicy: artifact.retentionPolicy }),
      createdAt: artifact.createdAt,
    }
  },
})

export const recordEvidenceArtifact = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    traceId: v.optional(v.string()),
    kind: evidenceArtifactKindArg,
    label: v.optional(v.string()),
    storageProvider: v.literal('cloudflare-r2'),
    storageKey: v.string(),
    contentType: v.string(),
    sizeBytes: v.number(),
    sha256: v.string(),
    retentionPolicy: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  },
  returns: evidenceArtifactReturn,
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)

    const workflowRun = await ctx.db.get('workflowRuns', args.workflowRunId)
    if (workflowRun === null) {
      throw new ConvexError('Workflow run not found')
    }

    const createdAt = args.createdAt ?? Date.now()
    const artifact = {
      workflowRunId: args.workflowRunId,
      ...(args.traceId === undefined ? {} : { traceId: args.traceId }),
      kind: args.kind,
      ...(args.label === undefined ? {} : { label: args.label }),
      storageProvider: args.storageProvider,
      storageKey: args.storageKey,
      contentType: args.contentType,
      sizeBytes: args.sizeBytes,
      sha256: args.sha256,
      ...(args.retentionPolicy === undefined ? {} : { retentionPolicy: args.retentionPolicy }),
      createdAt,
    }
    const id = await ctx.db.insert('evidenceArtifacts', artifact)
    await insertProvenanceEvent(ctx, {
      workflowRunId: args.workflowRunId,
      traceId: args.traceId ?? workflowRun.traceId ?? 'legacy',
      type: 'evidence-artifact',
      operation: `evidenceArtifact.${args.kind}`,
      status: 'succeeded',
      startedAt: createdAt,
      completedAt: createdAt,
      summary: args.label ?? `Captured ${args.kind} artifact.`,
      artifactRefs: [String(id)],
      idempotencyKey: `${String(id)}:evidence-artifact`,
    })

    return { id, ...artifact }
  },
})

export const recordCandidatePatchSet = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    status: candidatePatchSetStatusArg,
    baseRef: v.optional(v.string()),
    baseSha: v.optional(v.string()),
    headRef: v.optional(v.string()),
    headSha: v.optional(v.string()),
    diffArtifactId: v.optional(v.id('evidenceArtifacts')),
    summary: v.optional(v.string()),
    stats: v.optional(candidatePatchSetStatsArg),
    createdAt: v.optional(v.number()),
  },
  returns: candidatePatchSetReturn,
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const workflowRun = await requireWorkflowRun(ctx, args.workflowRunId)
    if (args.diffArtifactId !== undefined) {
      await requireEvidenceArtifactForWorkflow(ctx, args.diffArtifactId, args.workflowRunId)
    }

    const createdAt = args.createdAt ?? Date.now()
    const patchSet = {
      workflowRunId: args.workflowRunId,
      status: args.status,
      ...(args.baseRef === undefined ? {} : { baseRef: args.baseRef }),
      ...(args.baseSha === undefined ? {} : { baseSha: args.baseSha }),
      ...(args.headRef === undefined ? {} : { headRef: args.headRef }),
      ...(args.headSha === undefined ? {} : { headSha: args.headSha }),
      ...(args.diffArtifactId === undefined ? {} : { diffArtifactId: args.diffArtifactId }),
      ...(args.summary === undefined ? {} : { summary: args.summary }),
      ...(args.stats === undefined ? {} : { stats: args.stats }),
      createdAt,
    }
    const id = await ctx.db.insert('candidatePatchSets', patchSet)
    await insertProvenanceEvent(ctx, {
      workflowRunId: args.workflowRunId,
      traceId: workflowRun.traceId ?? 'legacy',
      type: 'candidate-patch-set',
      operation: 'candidatePatchSet.recorded',
      status: args.status === 'failed' ? 'failed' : 'succeeded',
      startedAt: createdAt,
      completedAt: createdAt,
      summary: args.summary ?? `Candidate patch set ${args.status}.`,
      artifactRefs: [
        String(id),
        ...(args.diffArtifactId === undefined ? [] : [String(args.diffArtifactId)]),
      ],
      idempotencyKey: `${String(id)}:candidate-patch-set`,
    })

    return { id, ...patchSet }
  },
})

export const recordReviewRun = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    sandboxExecutionId: v.optional(v.id('sandboxExecutions')),
    candidatePatchSetId: v.optional(v.id('candidatePatchSets')),
    kind: reviewRunKindArg,
    reviewer: v.string(),
    status: reviewRunStatusArg,
    summary: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  },
  returns: reviewRunReturn,
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const workflowRun = await requireWorkflowRun(ctx, args.workflowRunId)

    if (args.sandboxExecutionId !== undefined) {
      const sandboxExecution = await ctx.db.get('sandboxExecutions', args.sandboxExecutionId)
      if (sandboxExecution === null || sandboxExecution.workflowRunId !== args.workflowRunId) {
        throw new ConvexError('Sandbox execution does not belong to workflow')
      }
    }
    if (args.candidatePatchSetId !== undefined) {
      const candidatePatchSet = await ctx.db.get('candidatePatchSets', args.candidatePatchSetId)
      if (candidatePatchSet === null || candidatePatchSet.workflowRunId !== args.workflowRunId) {
        throw new ConvexError('Candidate patch set does not belong to workflow')
      }
    }

    const createdAt = args.createdAt ?? Date.now()
    const reviewRun = {
      workflowRunId: args.workflowRunId,
      ...(args.sandboxExecutionId === undefined ? {} : { sandboxExecutionId: args.sandboxExecutionId }),
      ...(args.candidatePatchSetId === undefined ? {} : { candidatePatchSetId: args.candidatePatchSetId }),
      kind: args.kind,
      reviewer: args.reviewer,
      status: args.status,
      ...(args.summary === undefined ? {} : { summary: args.summary }),
      startedAt: args.startedAt,
      ...(args.completedAt === undefined ? {} : { completedAt: args.completedAt }),
      createdAt,
    }
    const id = await ctx.db.insert('reviewRuns', reviewRun)
    await insertProvenanceEvent(ctx, {
      workflowRunId: args.workflowRunId,
      traceId: workflowRun.traceId ?? 'legacy',
      type: 'review-run',
      operation: `reviewRun.${args.kind}`,
      status: args.status === 'failed' ? 'failed' : args.status === 'running' ? 'started' : 'succeeded',
      startedAt: args.startedAt,
      completedAt: args.completedAt ?? createdAt,
      summary: args.summary ?? `Review run ${args.kind} ${args.status}.`,
      artifactRefs: [
        String(id),
        ...(args.sandboxExecutionId === undefined ? [] : [String(args.sandboxExecutionId)]),
        ...(args.candidatePatchSetId === undefined ? [] : [String(args.candidatePatchSetId)]),
      ],
      idempotencyKey: `${String(id)}:review-run`,
    })

    return { id, ...reviewRun }
  },
})

export const recordReviewFinding = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    reviewRunId: v.optional(v.id('reviewRuns')),
    severity: reviewFindingSeverityArg,
    category: reviewFindingCategoryArg,
    message: v.string(),
    path: v.optional(v.string()),
    startLine: v.optional(v.number()),
    endLine: v.optional(v.number()),
    evidenceArtifactId: v.optional(v.id('evidenceArtifacts')),
    createdAt: v.optional(v.number()),
  },
  returns: reviewFindingReturn,
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const workflowRun = await requireWorkflowRun(ctx, args.workflowRunId)
    if (args.reviewRunId !== undefined) {
      await requireReviewRunForWorkflow(ctx, args.reviewRunId, args.workflowRunId)
    }
    if (args.evidenceArtifactId !== undefined) {
      await requireEvidenceArtifactForWorkflow(ctx, args.evidenceArtifactId, args.workflowRunId)
    }

    const createdAt = args.createdAt ?? Date.now()
    const finding = {
      workflowRunId: args.workflowRunId,
      ...(args.reviewRunId === undefined ? {} : { reviewRunId: args.reviewRunId }),
      severity: args.severity,
      category: args.category,
      message: args.message,
      ...(args.path === undefined ? {} : { path: args.path }),
      ...(args.startLine === undefined ? {} : { startLine: args.startLine }),
      ...(args.endLine === undefined ? {} : { endLine: args.endLine }),
      ...(args.evidenceArtifactId === undefined ? {} : { evidenceArtifactId: args.evidenceArtifactId }),
      createdAt,
    }
    const id = await ctx.db.insert('reviewFindings', finding)
    await insertProvenanceEvent(ctx, {
      workflowRunId: args.workflowRunId,
      traceId: workflowRun.traceId ?? 'legacy',
      type: 'review-finding',
      operation: `reviewFinding.${args.category}`,
      status: args.severity === 'critical' || args.severity === 'error' ? 'failed' : 'succeeded',
      startedAt: createdAt,
      completedAt: createdAt,
      summary: args.message,
      artifactRefs: [
        String(id),
        ...(args.reviewRunId === undefined ? [] : [String(args.reviewRunId)]),
        ...(args.evidenceArtifactId === undefined ? [] : [String(args.evidenceArtifactId)]),
      ],
      idempotencyKey: `${String(id)}:review-finding`,
    })

    return { id, ...finding }
  },
})

export const recordPolicyDecision = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    reviewRunId: v.optional(v.id('reviewRuns')),
    status: policyDecisionStatusArg,
    summary: v.string(),
    reason: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  },
  returns: policyDecisionReturn,
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const workflowRun = await requireWorkflowRun(ctx, args.workflowRunId)
    if (args.reviewRunId !== undefined) {
      await requireReviewRunForWorkflow(ctx, args.reviewRunId, args.workflowRunId)
    }

    const createdAt = args.createdAt ?? Date.now()
    const decision = {
      workflowRunId: args.workflowRunId,
      ...(args.reviewRunId === undefined ? {} : { reviewRunId: args.reviewRunId }),
      status: args.status,
      summary: args.summary,
      ...(args.reason === undefined ? {} : { reason: args.reason }),
      createdAt,
    }
    const id = await ctx.db.insert('policyDecisions', decision)
    await insertProvenanceEvent(ctx, {
      workflowRunId: args.workflowRunId,
      traceId: workflowRun.traceId ?? 'legacy',
      type: 'policy-decision',
      operation: 'policyDecision.recorded',
      status: args.status === 'approved' ? 'succeeded' : args.status === 'manual-review' ? 'blocked' : 'failed',
      startedAt: createdAt,
      completedAt: createdAt,
      summary: args.summary,
      artifactRefs: [
        String(id),
        ...(args.reviewRunId === undefined ? [] : [String(args.reviewRunId)]),
      ],
      idempotencyKey: `${String(id)}:policy-decision`,
    })

    return { id, ...decision }
  },
})

export const recordPublicationResult = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    provider: v.string(),
    kind: publicationResultKindArg,
    status: publicationResultStatusArg,
    externalId: v.optional(v.string()),
    url: v.optional(v.string()),
    summary: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    idempotencyKey: v.optional(v.string()),
  },
  returns: publicationResultReturn,
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const workflowRun = await requireWorkflowRun(ctx, args.workflowRunId)

    if (args.idempotencyKey !== undefined) {
      const existing = await ctx.db
        .query('publicationResults')
        .withIndex('by_workflow_publication_key', (q) =>
          q
            .eq('workflowRunId', args.workflowRunId)
            .eq('idempotencyKey', args.idempotencyKey),
        )
        .unique()

      if (existing !== null) {
        if (existing.status === 'published') {
          return {
            id: existing._id,
            workflowRunId: existing.workflowRunId,
            provider: existing.provider,
            kind: existing.kind,
            status: existing.status,
            ...(existing.externalId === undefined ? {} : { externalId: existing.externalId }),
            ...(existing.url === undefined ? {} : { url: existing.url }),
            ...(existing.summary === undefined ? {} : { summary: existing.summary }),
            ...(existing.error === undefined ? {} : { error: existing.error }),
            createdAt: existing.createdAt,
            ...(existing.idempotencyKey === undefined ? {} : { idempotencyKey: existing.idempotencyKey }),
          }
        }

        const createdAt = args.createdAt ?? Date.now()
        const updated = {
          provider: args.provider,
          kind: args.kind,
          status: args.status,
          externalId: args.externalId,
          url: args.url,
          summary: args.summary,
          error: args.error,
          createdAt,
          idempotencyKey: args.idempotencyKey,
        }
        await ctx.db.patch('publicationResults', existing._id, updated)
        await insertProvenanceEvent(ctx, {
          workflowRunId: args.workflowRunId,
          traceId: workflowRun.traceId ?? 'legacy',
          type: 'publication-result',
          operation: `publicationResult.${args.kind}.retry`,
          pluginName: args.provider,
          status: args.status === 'published' ? 'succeeded' : args.status === 'pending' ? 'started' : 'failed',
          startedAt: createdAt,
          completedAt: createdAt,
          summary: args.summary ?? `Publication ${args.kind} ${args.status}.`,
          artifactRefs: [String(existing._id)],
          errorCategory: args.error === undefined ? undefined : 'publication',
          idempotencyKey: `${args.idempotencyKey}:provenance:${args.status}`,
        })
        return { id: existing._id, workflowRunId: existing.workflowRunId, ...updated }
      }
    }

    const createdAt = args.createdAt ?? Date.now()
    const result = {
      workflowRunId: args.workflowRunId,
      provider: args.provider,
      kind: args.kind,
      status: args.status,
      ...(args.externalId === undefined ? {} : { externalId: args.externalId }),
      ...(args.url === undefined ? {} : { url: args.url }),
      ...(args.summary === undefined ? {} : { summary: args.summary }),
      ...(args.error === undefined ? {} : { error: args.error }),
      createdAt,
      ...(args.idempotencyKey === undefined ? {} : { idempotencyKey: args.idempotencyKey }),
    }
    const id = await ctx.db.insert('publicationResults', result)
    await insertProvenanceEvent(ctx, {
      workflowRunId: args.workflowRunId,
      traceId: workflowRun.traceId ?? 'legacy',
      type: 'publication-result',
      operation: `publicationResult.${args.kind}`,
      pluginName: args.provider,
      status: args.status === 'published' ? 'succeeded' : args.status === 'pending' ? 'started' : 'failed',
      startedAt: createdAt,
      completedAt: createdAt,
      summary: args.summary ?? `Publication ${args.kind} ${args.status}.`,
      artifactRefs: [String(id)],
      errorCategory: args.error === undefined ? undefined : 'publication',
      idempotencyKey: args.idempotencyKey === undefined
        ? `${String(id)}:publication-result`
        : `${args.idempotencyKey}:provenance`,
    })

    return { id, ...result }
  },
})

export const recordProvenanceEvent = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    traceId: v.string(),
    parentEventId: v.optional(v.string()),
    type: v.string(),
    operation: v.string(),
    pluginName: v.optional(v.string()),
    status: provenanceEventStatusArg,
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    summary: v.optional(v.string()),
    artifactRefs: v.array(v.string()),
    errorCategory: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
  },
  returns: provenanceEventReturn,
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    await requireWorkflowRun(ctx, args.workflowRunId)

    return insertProvenanceEvent(ctx, {
      workflowRunId: args.workflowRunId,
      traceId: args.traceId,
      ...(args.parentEventId === undefined ? {} : { parentEventId: args.parentEventId }),
      type: args.type,
      operation: args.operation,
      ...(args.pluginName === undefined ? {} : { pluginName: args.pluginName }),
      status: args.status,
      startedAt: args.startedAt,
      ...(args.completedAt === undefined ? {} : { completedAt: args.completedAt }),
      ...(args.summary === undefined ? {} : { summary: args.summary }),
      artifactRefs: args.artifactRefs,
      ...(args.errorCategory === undefined ? {} : { errorCategory: args.errorCategory }),
      ...(args.idempotencyKey === undefined ? {} : { idempotencyKey: args.idempotencyKey }),
    })
  },
})

export const recordSandboxExecution = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    provider: v.string(),
    sandboxId: v.string(),
    command: v.string(),
    status: v.union(v.literal('succeeded'), v.literal('failed')),
    exitCode: v.optional(v.number()),
    stdout: v.string(),
    stderr: v.optional(v.string()),
    policy: v.optional(sandboxPolicyArg),
    startedAt: v.number(),
    completedAt: v.number(),
  },
  returns: sandboxExecutionReturn,
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)

    const workflowRun = await ctx.db.get('workflowRuns', args.workflowRunId)
    if (workflowRun === null) {
      throw new ConvexError('Workflow run not found')
    }

    const id = await ctx.db.insert('sandboxExecutions', {
      workflowRunId: args.workflowRunId,
      provider: args.provider,
      sandboxId: args.sandboxId,
      command: args.command,
      status: args.status,
      ...(args.exitCode === undefined ? {} : { exitCode: args.exitCode }),
      stdout: args.stdout,
      ...(args.stderr === undefined ? {} : { stderr: args.stderr }),
      ...(args.policy === undefined ? {} : { policy: args.policy }),
      startedAt: args.startedAt,
      completedAt: args.completedAt,
      createdAt: Date.now(),
    })

    if (workflowRun.status === 'queued') {
      await ctx.db.patch('workflowRuns', args.workflowRunId, { status: 'reviewed' })
    }

    await insertProvenanceEvent(ctx, {
      workflowRunId: args.workflowRunId,
      traceId: workflowRun.traceId ?? 'legacy',
      type: 'sandbox-execution',
      operation: 'sandboxExecution.command',
      pluginName: args.provider,
      status: args.status === 'succeeded' ? 'succeeded' : 'failed',
      startedAt: args.startedAt,
      completedAt: args.completedAt,
      summary: `${args.command} exited ${args.exitCode ?? 'unknown'}.`,
      artifactRefs: [String(id)],
      idempotencyKey: `${String(id)}:sandbox-execution`,
    })

    return {
      id,
      workflowRunId: args.workflowRunId,
      provider: args.provider,
      sandboxId: args.sandboxId,
      command: args.command,
      status: args.status,
      ...(args.exitCode === undefined ? {} : { exitCode: args.exitCode }),
      stdout: args.stdout,
      ...(args.stderr === undefined ? {} : { stderr: args.stderr }),
      ...(args.policy === undefined ? {} : { policy: args.policy }),
      startedAt: args.startedAt,
      completedAt: args.completedAt,
    }
  },
})

export const authorizeRuntimeControl = query({
  args: {
    workflowRunId: v.id('workflowRuns'),
  },
  returns: v.object({
    workflowRunId: v.id('workflowRuns'),
    workspaceId: v.string(),
    allowed: v.literal(true),
  }),
  handler: async (ctx, args) => {
    const identity = await requireWorkOSIdentity(ctx)
    const workflowRun = await ctx.db.get('workflowRuns', args.workflowRunId)

    if (workflowRun === null) {
      throw new ConvexError('Workflow run not found')
    }

    requireWorkOSWorkspace(identity, workflowRun.workspaceId)
    await requireMembershipPermission(
      ctx,
      identity,
      workflowRun.workspaceId,
      'run:interrupt',
    )

    return {
      workflowRunId: workflowRun['_id'],
      workspaceId: workflowRun.workspaceId,
      allowed: true as const,
    }
  },
})

export const recordHumanDecision = mutation({
  args: {
    workflowRunId: v.id('workflowRuns'),
    sandboxExecutionId: v.optional(v.id('sandboxExecutions')),
    candidatePatchSetId: v.optional(v.id('candidatePatchSets')),
    reviewRunId: v.optional(v.id('reviewRuns')),
    policyDecisionId: v.optional(v.id('policyDecisions')),
    status: decisionStatusArg,
    comment: v.string(),
    idempotencyKey: v.optional(v.string()),
  },
  returns: humanDecisionReturn,
  handler: async (ctx, args) => {
    const comment = args.comment.trim()
    if (comment.length === 0) {
      throw new ConvexError('Decision comment required')
    }

    const identity = await requireWorkOSIdentity(ctx)
    const workflowRun = await requireWorkflowRun(ctx, args.workflowRunId)
    requireWorkOSWorkspace(identity, workflowRun.workspaceId)
    await requireMembershipPermission(
      ctx,
      identity,
      workflowRun.workspaceId,
      args.status === 'approved' ? 'decision:approve' : 'decision:reject',
    )

    if (args.idempotencyKey !== undefined) {
      const existing = await ctx.db
        .query('humanDecisions')
        .withIndex('by_workflow_decision_key', (q) =>
          q
            .eq('workflowRunId', args.workflowRunId)
            .eq('idempotencyKey', args.idempotencyKey),
        )
        .unique()

      if (existing !== null) {
        if (
          existing.status !== args.status ||
          existing.comment !== comment ||
          existing.sandboxExecutionId !== args.sandboxExecutionId ||
          existing.candidatePatchSetId !== args.candidatePatchSetId ||
          existing.reviewRunId !== args.reviewRunId ||
          existing.policyDecisionId !== args.policyDecisionId
        ) {
          throw new ConvexError('Human decision idempotency key conflict')
        }
        return {
          id: existing._id,
          workflowRunId: existing.workflowRunId,
          ...(existing.sandboxExecutionId === undefined ? {} : { sandboxExecutionId: existing.sandboxExecutionId }),
          ...(existing.candidatePatchSetId === undefined ? {} : { candidatePatchSetId: existing.candidatePatchSetId }),
          ...(existing.reviewRunId === undefined ? {} : { reviewRunId: existing.reviewRunId }),
          ...(existing.policyDecisionId === undefined ? {} : { policyDecisionId: existing.policyDecisionId }),
          actorId: existing.actorId,
          status: existing.status,
          comment: existing.comment,
          decidedAt: existing.decidedAt,
          ...(existing.idempotencyKey === undefined ? {} : { idempotencyKey: existing.idempotencyKey }),
        }
      }
    }

    if (
      args.sandboxExecutionId === undefined ||
      args.candidatePatchSetId === undefined ||
      args.reviewRunId === undefined ||
      args.policyDecisionId === undefined
    ) {
      throw new ConvexError('Displayed review projection IDs required')
    }

    const [
      sandboxExecution,
      candidatePatchSet,
      reviewRun,
      policyDecision,
      sandboxExecutions,
      candidatePatchSets,
      reviewRuns,
      policyDecisions,
    ] = await Promise.all([
      ctx.db.get('sandboxExecutions', args.sandboxExecutionId),
      ctx.db.get('candidatePatchSets', args.candidatePatchSetId),
      ctx.db.get('reviewRuns', args.reviewRunId),
      ctx.db.get('policyDecisions', args.policyDecisionId),
      ctx.db.query('sandboxExecutions').withIndex('by_workflow_run', (q) => q.eq('workflowRunId', args.workflowRunId)).order('desc').take(32),
      ctx.db.query('candidatePatchSets').withIndex('by_workflow_run', (q) => q.eq('workflowRunId', args.workflowRunId)).order('desc').take(32),
      ctx.db.query('reviewRuns').withIndex('by_workflow_run', (q) => q.eq('workflowRunId', args.workflowRunId)).order('desc').take(32),
      ctx.db.query('policyDecisions').withIndex('by_workflow_run', (q) => q.eq('workflowRunId', args.workflowRunId)).order('desc').take(32),
    ])
    if (sandboxExecution === null || sandboxExecution.workflowRunId !== args.workflowRunId) {
      throw new ConvexError('Sandbox execution does not belong to workflow')
    }
    if (candidatePatchSet === null || candidatePatchSet.workflowRunId !== args.workflowRunId) {
      throw new ConvexError('Candidate patch set does not belong to workflow')
    }
    if (reviewRun === null || reviewRun.workflowRunId !== args.workflowRunId) {
      throw new ConvexError('Review run does not belong to workflow')
    }
    if (policyDecision === null || policyDecision.workflowRunId !== args.workflowRunId) {
      throw new ConvexError('Policy decision does not belong to workflow')
    }

    const latestSandboxExecution = sandboxExecutions.reduce<(typeof sandboxExecutions)[number] | undefined>(
      (latest, execution) => latest === undefined || execution.completedAt > latest.completedAt ? execution : latest,
      undefined,
    )
    const latestCandidatePatchSet = candidatePatchSets.reduce<(typeof candidatePatchSets)[number] | undefined>(
      (latest, candidate) => latest === undefined || candidate.createdAt > latest.createdAt ? candidate : latest,
      undefined,
    )
    const latestReviewRun = reviewRuns.reduce<(typeof reviewRuns)[number] | undefined>(
      (latest, review) => latest === undefined || review.createdAt > latest.createdAt ? review : latest,
      undefined,
    )
    const latestPolicyDecision = policyDecisions.reduce<(typeof policyDecisions)[number] | undefined>(
      (latest, decision) => latest === undefined || decision.createdAt > latest.createdAt ? decision : latest,
      undefined,
    )
    if (
      latestSandboxExecution?._id !== sandboxExecution._id ||
      latestCandidatePatchSet?._id !== candidatePatchSet._id ||
      latestReviewRun?._id !== reviewRun._id ||
      latestPolicyDecision?._id !== policyDecision._id
    ) {
      throw new ConvexError('Displayed review projection is stale')
    }

    if (candidatePatchSet.createdAt < sandboxExecution.completedAt) {
      throw new ConvexError('Candidate patch set predates latest sandbox execution')
    }
    if (
      reviewRun.sandboxExecutionId !== sandboxExecution._id ||
      reviewRun.candidatePatchSetId !== candidatePatchSet._id
    ) {
      throw new ConvexError('Review run must reference displayed sandbox and candidate patch')
    }
    if (policyDecision.reviewRunId !== reviewRun._id) {
      throw new ConvexError('Policy decision must reference latest review run')
    }

    const decision = {
      workflowRunId: args.workflowRunId,
      sandboxExecutionId: sandboxExecution._id,
      candidatePatchSetId: candidatePatchSet._id,
      reviewRunId: reviewRun._id,
      policyDecisionId: policyDecision._id,
      actorId: `workos:${identity.subject}`,
      status: args.status,
      comment,
      decidedAt: Date.now(),
      ...(args.idempotencyKey === undefined ? {} : { idempotencyKey: args.idempotencyKey }),
    }
    const id = await ctx.db.insert('humanDecisions', decision)
    await insertProvenanceEvent(ctx, {
      workflowRunId: args.workflowRunId,
      traceId: workflowRun.traceId ?? 'legacy',
      type: 'human-decision',
      operation: 'humanDecision.recorded',
      status: args.status === 'approved' ? 'succeeded' : args.status === 'changes-requested' ? 'blocked' : 'failed',
      startedAt: decision.decidedAt,
      completedAt: decision.decidedAt,
      summary: comment,
      artifactRefs: [String(id)],
      idempotencyKey: `${String(id)}:human-decision`,
    })

    return { id, ...decision }
  },
})

export const getTrustLoopAcceptanceSnapshot = query({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
  },
  returns: v.object({
    workflowRunId: v.string(),
    traceId: v.string(),
    workflowStatus: v.union(v.literal('queued'), v.literal('running'), v.literal('reviewed')),
    hasRuntimeEvents: v.boolean(),
    hasRuntimeSessions: v.boolean(),
    sandboxExecutionStatuses: v.array(v.union(v.literal('succeeded'), v.literal('failed'))),
    latestSandboxExecution: v.optional(v.object({
      id: v.string(),
      status: v.union(v.literal('succeeded'), v.literal('failed')),
      completedAt: v.number(),
    })),
    evidenceArtifacts: v.array(v.object({
      id: v.string(),
      kind: evidenceArtifactKindArg,
      storageKey: v.string(),
      sizeBytes: v.number(),
      sha256: v.string(),
      createdAt: v.number(),
    })),
    candidatePatchStatuses: v.array(candidatePatchSetStatusArg),
    latestCandidatePatchSet: v.optional(v.object({
      id: v.string(),
      status: candidatePatchSetStatusArg,
      diffArtifactId: v.optional(v.string()),
      headSha: v.optional(v.string()),
      createdAt: v.number(),
    })),
    reviewRunStatuses: v.array(reviewRunStatusArg),
    latestReviewRun: v.optional(v.object({
      id: v.string(),
      sandboxExecutionId: v.optional(v.string()),
      candidatePatchSetId: v.optional(v.string()),
      status: reviewRunStatusArg,
      createdAt: v.number(),
    })),
    policyDecisionStatuses: v.array(policyDecisionStatusArg),
    latestPolicyDecision: v.optional(v.object({
      status: policyDecisionStatusArg,
      reviewRunId: v.optional(v.string()),
      createdAt: v.number(),
    })),
    humanDecisions: v.array(v.object({
      id: v.string(),
      status: decisionStatusArg,
      decidedAt: v.number(),
      idempotencyKey: v.optional(v.string()),
    })),
    publicationResults: v.array(v.object({
      kind: publicationResultKindArg,
      status: publicationResultStatusArg,
      externalId: v.optional(v.string()),
      url: v.optional(v.string()),
      idempotencyKey: v.optional(v.string()),
    })),
    hasProvenanceEvents: v.boolean(),
  }),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const workflowRun = await requireWorkflowRun(ctx, args.workflowRunId)
    const [runtimeEvents, runtimeSessions, sandboxExecutions, evidenceArtifacts, candidatePatchSets, reviewRuns, policyDecisions, humanDecisions, publicationResults, provenanceEvents] = await Promise.all([
      ctx.db.query('runtimeEvents').withIndex('by_workflow_run', (q) => q.eq('workflowRunId', args.workflowRunId)).take(1),
      ctx.db.query('runtimeSessions').withIndex('by_workflow_run', (q) => q.eq('workflowRunId', args.workflowRunId)).take(1),
      ctx.db.query('sandboxExecutions').withIndex('by_workflow_run', (q) => q.eq('workflowRunId', args.workflowRunId)).order('desc').take(32),
      ctx.db.query('evidenceArtifacts').withIndex('by_workflow_run', (q) => q.eq('workflowRunId', args.workflowRunId)).order('desc').take(128),
      ctx.db.query('candidatePatchSets').withIndex('by_workflow_run', (q) => q.eq('workflowRunId', args.workflowRunId)).order('desc').take(32),
      ctx.db.query('reviewRuns').withIndex('by_workflow_run', (q) => q.eq('workflowRunId', args.workflowRunId)).order('desc').take(32),
      ctx.db.query('policyDecisions').withIndex('by_workflow_run', (q) => q.eq('workflowRunId', args.workflowRunId)).order('desc').take(32),
      ctx.db.query('humanDecisions').withIndex('by_workflow_run', (q) => q.eq('workflowRunId', args.workflowRunId)).order('desc').take(32),
      ctx.db.query('publicationResults').withIndex('by_workflow_run', (q) => q.eq('workflowRunId', args.workflowRunId)).order('desc').take(64),
      ctx.db.query('provenanceEvents').withIndex('by_workflow_run', (q) => q.eq('workflowRunId', args.workflowRunId)).take(1),
    ])

    const latestSandboxExecution = sandboxExecutions.reduce<(typeof sandboxExecutions)[number] | undefined>(
      (latest, execution) => latest === undefined || execution.completedAt > latest.completedAt
        ? execution
        : latest,
      undefined,
    )
    const latestCandidatePatchSet = candidatePatchSets.reduce<(typeof candidatePatchSets)[number] | undefined>(
      (latest, candidate) => latest === undefined || candidate.createdAt > latest.createdAt
        ? candidate
        : latest,
      undefined,
    )
    const latestReviewRun = reviewRuns.reduce<(typeof reviewRuns)[number] | undefined>(
      (latest, review) => latest === undefined || review.createdAt > latest.createdAt
        ? review
        : latest,
      undefined,
    )
    const latestPolicyDecision = policyDecisions.reduce<(typeof policyDecisions)[number] | undefined>(
      (latest, decision) => latest === undefined || decision.createdAt > latest.createdAt
        ? decision
        : latest,
      undefined,
    )

    return {
      workflowRunId: workflowRun._id,
      traceId: workflowRun.traceId ?? 'legacy',
      workflowStatus: workflowRun.status,
      hasRuntimeEvents: runtimeEvents.length > 0,
      hasRuntimeSessions: runtimeSessions.length > 0,
      sandboxExecutionStatuses: sandboxExecutions.map((execution) => execution.status),
      ...(latestSandboxExecution === undefined ? {} : {
        latestSandboxExecution: {
          id: latestSandboxExecution['_id'],
          status: latestSandboxExecution.status,
          completedAt: latestSandboxExecution.completedAt,
        },
      }),
      evidenceArtifacts: evidenceArtifacts.map((artifact) => ({
        id: artifact['_id'],
        kind: artifact.kind,
        storageKey: artifact.storageKey,
        sizeBytes: artifact.sizeBytes,
        sha256: artifact.sha256,
        createdAt: artifact.createdAt,
      })),
      candidatePatchStatuses: candidatePatchSets.map((patchSet) => patchSet.status),
      ...(latestCandidatePatchSet === undefined ? {} : {
        latestCandidatePatchSet: {
          id: latestCandidatePatchSet['_id'],
          status: latestCandidatePatchSet.status,
          ...(latestCandidatePatchSet.diffArtifactId === undefined ? {} : { diffArtifactId: latestCandidatePatchSet.diffArtifactId }),
          ...(latestCandidatePatchSet.headSha === undefined ? {} : { headSha: latestCandidatePatchSet.headSha }),
          createdAt: latestCandidatePatchSet.createdAt,
        },
      }),
      reviewRunStatuses: reviewRuns.map((reviewRun) => reviewRun.status),
      ...(latestReviewRun === undefined ? {} : {
        latestReviewRun: {
          id: latestReviewRun['_id'],
          ...(latestReviewRun.sandboxExecutionId === undefined ? {} : { sandboxExecutionId: latestReviewRun.sandboxExecutionId }),
          ...(latestReviewRun.candidatePatchSetId === undefined ? {} : { candidatePatchSetId: latestReviewRun.candidatePatchSetId }),
          status: latestReviewRun.status,
          createdAt: latestReviewRun.createdAt,
        },
      }),
      policyDecisionStatuses: policyDecisions.map((decision) => decision.status),
      ...(latestPolicyDecision === undefined ? {} : {
        latestPolicyDecision: {
          status: latestPolicyDecision.status,
          ...(latestPolicyDecision.reviewRunId === undefined ? {} : { reviewRunId: latestPolicyDecision.reviewRunId }),
          createdAt: latestPolicyDecision.createdAt,
        },
      }),
      humanDecisions: humanDecisions.map((decision) => ({
        // oxlint-disable-next-line eslint/no-underscore-dangle -- Convex document IDs are exposed as `_id`.
        id: decision._id,
        status: decision.status,
        decidedAt: decision.decidedAt,
        ...(decision.idempotencyKey === undefined ? {} : { idempotencyKey: decision.idempotencyKey }),
      })),
      publicationResults: publicationResults.map((result) => ({
        kind: result.kind,
        status: result.status,
        ...(result.externalId === undefined ? {} : { externalId: result.externalId }),
        ...(result.url === undefined ? {} : { url: result.url }),
        ...(result.idempotencyKey === undefined ? {} : { idempotencyKey: result.idempotencyKey }),
      })),
      hasProvenanceEvents: provenanceEvents.length > 0,
    }
  },
})

export const getDecisionPublicationReplayFixture = query({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    humanDecisionId: v.id('humanDecisions'),
  },
  returns: decisionPublicationReplayFixtureReturn,
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const workflowRun = await requireWorkflowRun(ctx, args.workflowRunId)
    const humanDecision = await ctx.db.get('humanDecisions', args.humanDecisionId)

    if (humanDecision === null || humanDecision.workflowRunId !== args.workflowRunId) {
      throw new ConvexError('Human decision not found')
    }

    const publicationKeys = [
      `${String(args.humanDecisionId)}:issue-comment`,
      `${String(args.humanDecisionId)}:check-run`,
    ] as const
    const [promptRequest, candidatePatchSets, correlatedCandidatePatchSet] = await Promise.all([
      ctx.db.get('promptRequests', workflowRun.promptRequestId),
      ctx.db
        .query('candidatePatchSets')
        .withIndex('by_workflow_run', (q) => q.eq('workflowRunId', args.workflowRunId))
        .order('desc')
        .take(32),
      humanDecision.candidatePatchSetId === undefined
        ? Promise.resolve(null)
        : ctx.db.get('candidatePatchSets', humanDecision.candidatePatchSetId),
    ])
    if (
      correlatedCandidatePatchSet !== null &&
      correlatedCandidatePatchSet.workflowRunId !== args.workflowRunId
    ) {
      throw new ConvexError('Decision candidate patch set does not belong to workflow')
    }
    // New decisions persist the exact candidate projection they reviewed.
    // The timestamp fallback supports legacy decisions recorded before that link existed.
    const candidatePatchSet = correlatedCandidatePatchSet ?? candidatePatchSets.reduce<(typeof candidatePatchSets)[number] | undefined>(
      (latest, candidate) => candidate.createdAt <= humanDecision.decidedAt &&
        (latest === undefined || candidate.createdAt > latest.createdAt)
        ? candidate
        : latest,
      undefined,
    )
    const publications = await Promise.all(
      publicationKeys.map((idempotencyKey) =>
        ctx.db
          .query('publicationResults')
          .withIndex('by_workflow_publication_key', (q) =>
            q
              .eq('workflowRunId', args.workflowRunId)
              .eq('idempotencyKey', idempotencyKey),
          )
          .unique(),
      ),
    )

    if (promptRequest === null) {
      throw new ConvexError('Workflow prompt request not found')
    }

    return {
      workflowStart: {
        promptRequest: {
          id: promptRequest['_id'],
          workspaceId: promptRequest.workspaceId,
          actorId: promptRequest.actorId,
          traceId: promptRequest.traceId ?? 'legacy',
          source: promptRequest.source,
          // Replay only needs repository coordinates and workflow identity.
          // Do not expose the original prompt through the system-secret helper.
          prompt: '[redacted for decision publication replay]',
          ...(promptRequest.externalRef === undefined ? {} : { externalRef: promptRequest.externalRef }),
          status: promptRequest.status,
          createdAt: promptRequest.createdAt,
        },
        workflowRun: {
          id: workflowRun['_id'],
          promptRequestId: workflowRun.promptRequestId,
          workspaceId: workflowRun.workspaceId,
          traceId: workflowRun.traceId ?? 'legacy',
          status: workflowRun.status,
          createdAt: workflowRun.createdAt,
        },
      },
      humanDecision: {
        id: humanDecision['_id'],
        workflowRunId: humanDecision.workflowRunId,
        ...(humanDecision.sandboxExecutionId === undefined ? {} : { sandboxExecutionId: humanDecision.sandboxExecutionId }),
        ...(humanDecision.candidatePatchSetId === undefined ? {} : { candidatePatchSetId: humanDecision.candidatePatchSetId }),
        ...(humanDecision.reviewRunId === undefined ? {} : { reviewRunId: humanDecision.reviewRunId }),
        ...(humanDecision.policyDecisionId === undefined ? {} : { policyDecisionId: humanDecision.policyDecisionId }),
        actorId: humanDecision.actorId,
        status: humanDecision.status,
        comment: '[redacted for decision publication replay]',
        decidedAt: humanDecision.decidedAt,
        ...(humanDecision.idempotencyKey === undefined ? {} : { idempotencyKey: humanDecision.idempotencyKey }),
      },
      ...(candidatePatchSet?.headSha === undefined
        ? {}
        : { candidateHeadSha: candidatePatchSet.headSha }),
      publicationResults: publications.flatMap((publication) => publication === null ? [] : [{
        id: publication['_id'],
        workflowRunId: publication.workflowRunId,
        provider: publication.provider,
        kind: publication.kind,
        status: publication.status,
        ...(publication.externalId === undefined ? {} : { externalId: publication.externalId }),
        ...(publication.url === undefined ? {} : { url: publication.url }),
        ...(publication.summary === undefined ? {} : { summary: publication.summary }),
        ...(publication.error === undefined ? {} : { error: publication.error }),
        createdAt: publication.createdAt,
        ...(publication.idempotencyKey === undefined ? {} : { idempotencyKey: publication.idempotencyKey }),
      }]),
    }
  },
})

export const getDetail = query({
  args: {
    workflowRunId: v.id('workflowRuns'),
  },
  returns: workflowDetailReturn,
  handler: async (ctx, args) => {
    const identity = await requireWorkOSIdentity(ctx)
    const workflowRun = await ctx.db.get('workflowRuns', args.workflowRunId)

    if (workflowRun === null) {
      throw new ConvexError('Workflow run not found')
    }

    requireWorkOSWorkspace(identity, workflowRun.workspaceId)
    await requireMembershipPermission(
      ctx,
      identity,
      workflowRun.workspaceId,
      'workspace:view',
    )

    const promptRequest = await ctx.db.get('promptRequests', workflowRun.promptRequestId)
    if (promptRequest === null) {
      throw new ConvexError('Workflow prompt request not found')
    }

    const runtimeEvents = await ctx.db
      .query('runtimeEvents')
      .withIndex('by_workflow_run', (q) => q.eq('workflowRunId', args.workflowRunId))
      .collect()

    const runtimeSessions = await ctx.db
      .query('runtimeSessions')
      .withIndex('by_workflow_run', (q) => q.eq('workflowRunId', args.workflowRunId))
      .collect()

    const sandboxExecutions = await ctx.db
      .query('sandboxExecutions')
      .withIndex('by_workflow_run', (q) => q.eq('workflowRunId', args.workflowRunId))
      .collect()

    const evidenceArtifacts = await ctx.db
      .query('evidenceArtifacts')
      .withIndex('by_workflow_run', (q) => q.eq('workflowRunId', args.workflowRunId))
      .collect()

    const candidatePatchSets = await ctx.db
      .query('candidatePatchSets')
      .withIndex('by_workflow_run', (q) => q.eq('workflowRunId', args.workflowRunId))
      .collect()

    const reviewRuns = await ctx.db
      .query('reviewRuns')
      .withIndex('by_workflow_run', (q) => q.eq('workflowRunId', args.workflowRunId))
      .collect()

    const reviewFindings = await ctx.db
      .query('reviewFindings')
      .withIndex('by_workflow_run', (q) => q.eq('workflowRunId', args.workflowRunId))
      .collect()

    const policyDecisions = await ctx.db
      .query('policyDecisions')
      .withIndex('by_workflow_run', (q) => q.eq('workflowRunId', args.workflowRunId))
      .collect()

    const humanDecisions = await ctx.db
      .query('humanDecisions')
      .withIndex('by_workflow_run', (q) => q.eq('workflowRunId', args.workflowRunId))
      .collect()

    const publicationResults = await ctx.db
      .query('publicationResults')
      .withIndex('by_workflow_run', (q) => q.eq('workflowRunId', args.workflowRunId))
      .collect()

    const provenanceEvents = await ctx.db
      .query('provenanceEvents')
      .withIndex('by_workflow_run', (q) => q.eq('workflowRunId', args.workflowRunId))
      .collect()

    return {
      promptRequest: {
        id: promptRequest['_id'],
        workspaceId: promptRequest.workspaceId,
        actorId: promptRequest.actorId,
        traceId: promptRequest.traceId ?? 'legacy',
        source: promptRequest.source,
        prompt: promptRequest.prompt,
        ...(promptRequest.externalRef === undefined
          ? {}
          : { externalRef: promptRequest.externalRef }),
        status: promptRequest.status,
        createdAt: promptRequest.createdAt,
      },
      workflowRun: {
        id: workflowRun['_id'],
        promptRequestId: workflowRun.promptRequestId,
        workspaceId: workflowRun.workspaceId,
        traceId: workflowRun.traceId ?? 'legacy',
        status: workflowRun.status,
        createdAt: workflowRun.createdAt,
      },
      runtimeEvents: sortedByNumber(runtimeEvents, (event) => event.occurredAt)
        .map((event) => ({
          id: event['_id'],
          workflowRunId: event.workflowRunId,
          provider: event.provider,
          type: event.type,
          occurredAt: event.occurredAt,
          ...(event.summary === undefined ? {} : { summary: event.summary }),
          ...(event.payloadJson === undefined ? {} : { payloadJson: event.payloadJson }),
          ...(event.idempotencyKey === undefined ? {} : { idempotencyKey: event.idempotencyKey }),
          ...(event.sourceSessionId === undefined ? {} : { sourceSessionId: event.sourceSessionId }),
          ...(event.sourceCommandId === undefined ? {} : { sourceCommandId: event.sourceCommandId }),
          ...(event.sourceStream === undefined ? {} : { sourceStream: event.sourceStream }),
          ...(event.sourceLine === undefined ? {} : { sourceLine: event.sourceLine }),
          ...(event.sourceOffset === undefined ? {} : { sourceOffset: event.sourceOffset }),
        })),
      runtimeSessions: sortedByNumber(runtimeSessions, (session) => session.startedAt)
        .map((session) => ({
          id: session['_id'],
          workflowRunId: session.workflowRunId,
          provider: session.provider,
          sandboxId: session.sandboxId,
          sessionId: session.sessionId,
          commandId: session.commandId,
          status: session.status,
          startedAt: session.startedAt,
          updatedAt: session.updatedAt,
          ...(session.completedAt === undefined ? {} : { completedAt: session.completedAt }),
        })),
      sandboxExecutions: sortedByNumber(sandboxExecutions, (execution) => execution.startedAt)
        .map((execution) => ({
          id: execution['_id'],
          workflowRunId: execution.workflowRunId,
          provider: execution.provider,
          sandboxId: execution.sandboxId,
          command: execution.command,
          status: execution.status,
          ...(execution.exitCode === undefined ? {} : { exitCode: execution.exitCode }),
          stdout: execution.stdout,
          ...(execution.stderr === undefined ? {} : { stderr: execution.stderr }),
          ...(execution.policy === undefined ? {} : { policy: execution.policy }),
          startedAt: execution.startedAt,
          completedAt: execution.completedAt,
        })),
      evidenceArtifacts: sortedByNumber(evidenceArtifacts, (artifact) => artifact.createdAt)
        .map((artifact) => ({
          id: artifact['_id'],
          workflowRunId: artifact.workflowRunId,
          ...(artifact.traceId === undefined ? {} : { traceId: artifact.traceId }),
          kind: artifact.kind,
          ...(artifact.label === undefined ? {} : { label: artifact.label }),
          storageProvider: artifact.storageProvider,
          storageKey: artifact.storageKey,
          contentType: artifact.contentType,
          sizeBytes: artifact.sizeBytes,
          sha256: artifact.sha256,
          ...(artifact.retentionPolicy === undefined ? {} : { retentionPolicy: artifact.retentionPolicy }),
          createdAt: artifact.createdAt,
        })),
      candidatePatchSets: sortedByNumber(candidatePatchSets, (patchSet) => patchSet.createdAt)
        .map((patchSet) => ({
          id: patchSet['_id'],
          workflowRunId: patchSet.workflowRunId,
          status: patchSet.status,
          ...(patchSet.baseRef === undefined ? {} : { baseRef: patchSet.baseRef }),
          ...(patchSet.baseSha === undefined ? {} : { baseSha: patchSet.baseSha }),
          ...(patchSet.headRef === undefined ? {} : { headRef: patchSet.headRef }),
          ...(patchSet.headSha === undefined ? {} : { headSha: patchSet.headSha }),
          ...(patchSet.diffArtifactId === undefined ? {} : { diffArtifactId: patchSet.diffArtifactId }),
          ...(patchSet.summary === undefined ? {} : { summary: patchSet.summary }),
          ...(patchSet.stats === undefined ? {} : { stats: patchSet.stats }),
          createdAt: patchSet.createdAt,
        })),
      reviewRuns: sortedByNumber(reviewRuns, (reviewRun) => reviewRun.startedAt)
        .map((reviewRun) => ({
          id: reviewRun['_id'],
          workflowRunId: reviewRun.workflowRunId,
          ...(reviewRun.sandboxExecutionId === undefined ? {} : { sandboxExecutionId: reviewRun.sandboxExecutionId }),
          ...(reviewRun.candidatePatchSetId === undefined ? {} : { candidatePatchSetId: reviewRun.candidatePatchSetId }),
          kind: reviewRun.kind,
          reviewer: reviewRun.reviewer,
          status: reviewRun.status,
          ...(reviewRun.summary === undefined ? {} : { summary: reviewRun.summary }),
          startedAt: reviewRun.startedAt,
          ...(reviewRun.completedAt === undefined ? {} : { completedAt: reviewRun.completedAt }),
          createdAt: reviewRun.createdAt,
        })),
      reviewFindings: sortedByNumber(reviewFindings, (finding) => finding.createdAt)
        .map((finding) => ({
          id: finding['_id'],
          workflowRunId: finding.workflowRunId,
          ...(finding.reviewRunId === undefined ? {} : { reviewRunId: finding.reviewRunId }),
          severity: finding.severity,
          category: finding.category,
          message: finding.message,
          ...(finding.path === undefined ? {} : { path: finding.path }),
          ...(finding.startLine === undefined ? {} : { startLine: finding.startLine }),
          ...(finding.endLine === undefined ? {} : { endLine: finding.endLine }),
          ...(finding.evidenceArtifactId === undefined ? {} : { evidenceArtifactId: finding.evidenceArtifactId }),
          createdAt: finding.createdAt,
        })),
      policyDecisions: sortedByNumber(policyDecisions, (decision) => decision.createdAt)
        .map((decision) => ({
          id: decision['_id'],
          workflowRunId: decision.workflowRunId,
          ...(decision.reviewRunId === undefined ? {} : { reviewRunId: decision.reviewRunId }),
          status: decision.status,
          summary: decision.summary,
          ...(decision.reason === undefined ? {} : { reason: decision.reason }),
          createdAt: decision.createdAt,
        })),
      humanDecisions: sortedByNumber(humanDecisions, (decision) => decision.decidedAt)
        .map((decision) => ({
          id: decision['_id'],
          workflowRunId: decision.workflowRunId,
          ...(decision.sandboxExecutionId === undefined ? {} : { sandboxExecutionId: decision.sandboxExecutionId }),
          ...(decision.candidatePatchSetId === undefined ? {} : { candidatePatchSetId: decision.candidatePatchSetId }),
          ...(decision.reviewRunId === undefined ? {} : { reviewRunId: decision.reviewRunId }),
          ...(decision.policyDecisionId === undefined ? {} : { policyDecisionId: decision.policyDecisionId }),
          actorId: decision.actorId,
          status: decision.status,
          comment: decision.comment,
          decidedAt: decision.decidedAt,
          ...(decision.idempotencyKey === undefined ? {} : { idempotencyKey: decision.idempotencyKey }),
        })),
      publicationResults: sortedByNumber(publicationResults, (result) => result.createdAt)
        .map((result) => ({
          id: result['_id'],
          workflowRunId: result.workflowRunId,
          provider: result.provider,
          kind: result.kind,
          status: result.status,
          ...(result.externalId === undefined ? {} : { externalId: result.externalId }),
          ...(result.url === undefined ? {} : { url: result.url }),
          ...(result.summary === undefined ? {} : { summary: result.summary }),
          ...(result.error === undefined ? {} : { error: result.error }),
          createdAt: result.createdAt,
          ...(result.idempotencyKey === undefined ? {} : { idempotencyKey: result.idempotencyKey }),
        })),
      provenanceEvents: sortedByNumber(provenanceEvents, (event) => event.sequence)
        .map((event) => ({
          id: event['_id'],
          workflowRunId: event.workflowRunId,
          traceId: event.traceId,
          ...(event.parentEventId === undefined ? {} : { parentEventId: event.parentEventId }),
          sequence: event.sequence,
          type: event.type,
          operation: event.operation,
          ...(event.pluginName === undefined ? {} : { pluginName: event.pluginName }),
          status: event.status,
          startedAt: event.startedAt,
          ...(event.completedAt === undefined ? {} : { completedAt: event.completedAt }),
          ...(event.summary === undefined ? {} : { summary: event.summary }),
          artifactRefs: event.artifactRefs,
          ...(event.errorCategory === undefined ? {} : { errorCategory: event.errorCategory }),
          ...(event.idempotencyKey === undefined ? {} : { idempotencyKey: event.idempotencyKey }),
        })),
    }
  },
})

export const listRecent = query({
  args: {
    workspaceId: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(workflowStartReturn),
  handler: async (ctx, args) => {
    const identity = await requireWorkOSIdentity(ctx)
    requireWorkOSWorkspace(identity, args.workspaceId)
    await requireMembershipPermission(
      ctx,
      identity,
      args.workspaceId,
      'workspace:view',
    )

    const workflowRuns = await ctx.db
      .query('workflowRuns')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', args.workspaceId))
      .order('desc')
      .take(args.limit ?? 10)

    const workflowStarts = []

    for (const workflowRun of workflowRuns) {
      const promptRequest = await ctx.db.get(
        'promptRequests',
        workflowRun.promptRequestId,
      )
      if (promptRequest === null) {
        continue
      }

      workflowStarts.push({
        promptRequest: {
          id: promptRequest['_id'],
          workspaceId: promptRequest.workspaceId,
          actorId: promptRequest.actorId,
          traceId: promptRequest.traceId ?? 'legacy',
          source: promptRequest.source,
          prompt: promptRequest.prompt,
          ...(promptRequest.externalRef === undefined
            ? {}
            : { externalRef: promptRequest.externalRef }),
          status: promptRequest.status,
          createdAt: promptRequest.createdAt,
        },
        workflowRun: {
          id: workflowRun['_id'],
          promptRequestId: workflowRun.promptRequestId,
          workspaceId: workflowRun.workspaceId,
          traceId: workflowRun.traceId ?? 'legacy',
          status: workflowRun.status,
          createdAt: workflowRun.createdAt,
        },
      })
    }

    return workflowStarts
  },
})
