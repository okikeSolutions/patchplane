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
    await ctx.db.patch('runtimeSessions', args.runtimeSessionId, {
      status: args.status,
      updatedAt,
      ...(args.completedAt === undefined ? {} : { completedAt: args.completedAt }),
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

    return { id, ...artifact }
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
