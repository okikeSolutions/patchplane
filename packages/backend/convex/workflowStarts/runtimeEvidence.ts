import { ConvexError, v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import {
  isEpochMillis,
  isValidProviderProcessIdentityPair,
  requireWorkOSWorkspace,
  requireWorkOSIdentity,
  requireMembershipPermission,
  sandboxPolicyArg,
  sortedByNumber,
  evidenceArtifactKindArg,
  evidenceArtifactReturn,
  runtimeEventReturn,
  runtimeSessionStatusArg,
  runtimeSessionReturn,
  sandboxExecutionReturn,
  requireSystemIngestionSecret,
  requireWorkflowRun,
  isLatestWorkflowAttempt,
  insertProvenanceEvent,
  sandboxExecutionValue,
} from './shared'

const recordRuntimeEvents = mutation({
  args: {
    systemSecret: v.string(),
    events: v.array(
      v.object({
        workflowRunId: v.id('workflowRuns'),
        provider: v.string(),
        type: v.string(),
        occurredAt: v.number(),
        summary: v.optional(v.string()),
        payloadJson: v.optional(v.string()),
        idempotencyKey: v.optional(v.string()),
        sourceSessionId: v.optional(v.string()),
        sourceCommandId: v.optional(v.string()),
        sourceStream: v.optional(
          v.union(v.literal('stdout'), v.literal('stderr')),
        ),
        sourceLine: v.optional(v.number()),
        sourceOffset: v.optional(v.number()),
      }),
    ),
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
            q
              .eq('workflowRunId', event.workflowRunId)
              .eq('idempotencyKey', event.idempotencyKey),
          )
          .unique()
        if (existing !== null) {
          rows.push({
            id: existing['_id'],
            workflowRunId: existing.workflowRunId,
            provider: existing.provider,
            type: existing.type,
            occurredAt: existing.occurredAt,
            ...(existing.summary === undefined
              ? {}
              : { summary: existing.summary }),
            ...(existing.payloadJson === undefined
              ? {}
              : { payloadJson: existing.payloadJson }),
            ...(existing.idempotencyKey === undefined
              ? {}
              : { idempotencyKey: existing.idempotencyKey }),
            ...(existing.sourceSessionId === undefined
              ? {}
              : { sourceSessionId: existing.sourceSessionId }),
            ...(existing.sourceCommandId === undefined
              ? {}
              : { sourceCommandId: existing.sourceCommandId }),
            ...(existing.sourceStream === undefined
              ? {}
              : { sourceStream: existing.sourceStream }),
            ...(existing.sourceLine === undefined
              ? {}
              : { sourceLine: existing.sourceLine }),
            ...(existing.sourceOffset === undefined
              ? {}
              : { sourceOffset: existing.sourceOffset }),
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
        idempotencyKey:
          event.idempotencyKey === undefined
            ? `${String(id)}:runtime-event`
            : `${event.idempotencyKey}:provenance`,
      })
      rows.push({ id, ...event })
    }

    return rows
  },
})

const recordRuntimeSessionStarted = mutation({
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
      await ctx.db.patch('workflowRuns', args.workflowRunId, {
        status: 'running',
      })
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

const markRuntimeSessionStatus = mutation({
  args: {
    systemSecret: v.string(),
    runtimeSessionId: v.id('runtimeSessions'),
    status: runtimeSessionStatusArg,
    completedAt: v.optional(v.number()),
  },
  returns: runtimeSessionReturn,
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const runtimeSession = await ctx.db.get(
      'runtimeSessions',
      args.runtimeSessionId,
    )
    if (runtimeSession === null) {
      throw new ConvexError('Runtime session not found')
    }

    const updatedAt = Date.now()
    const workflowRun = await requireWorkflowRun(
      ctx,
      runtimeSession.workflowRunId,
    )
    await ctx.db.patch('runtimeSessions', args.runtimeSessionId, {
      status: args.status,
      updatedAt,
      ...(args.completedAt === undefined
        ? {}
        : { completedAt: args.completedAt }),
    })

    await insertProvenanceEvent(ctx, {
      workflowRunId: runtimeSession.workflowRunId,
      traceId: workflowRun.traceId ?? 'legacy',
      type: 'runtime-session',
      operation: 'runtimeSession.status',
      pluginName: runtimeSession.provider,
      status:
        args.status === 'completed'
          ? 'succeeded'
          : args.status === 'running'
            ? 'started'
            : args.status === 'cancelled'
              ? 'blocked'
              : 'failed',
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
      ...(args.completedAt === undefined
        ? runtimeSession.completedAt === undefined
          ? {}
          : { completedAt: runtimeSession.completedAt }
        : { completedAt: args.completedAt }),
    }
  },
})

const getActiveRuntimeSession = query({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
  },
  returns: v.union(runtimeSessionReturn, v.null()),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)
    const sessions = await ctx.db
      .query('runtimeSessions')
      .withIndex('by_workflow_run', (q) =>
        q.eq('workflowRunId', args.workflowRunId),
      )
      .collect()

    const active = sortedByNumber(
      sessions.filter(
        (session) =>
          session.status === 'starting' || session.status === 'running',
      ),
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
      ...(active.completedAt === undefined
        ? {}
        : { completedAt: active.completedAt }),
    }
  },
})

const getEvidenceArtifact = query({
  args: {
    artifactId: v.id('evidenceArtifacts'),
    workflowRunId: v.optional(v.id('workflowRuns')),
    systemSecret: v.optional(v.string()),
  },
  returns: v.union(evidenceArtifactReturn, v.null()),
  handler: async (ctx, args) => {
    const artifact = await ctx.db.get('evidenceArtifacts', args.artifactId)
    if (artifact === null) return null

    if (
      args.workflowRunId !== undefined &&
      artifact.workflowRunId !== args.workflowRunId
    ) {
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
      ...(artifact.producer === undefined
        ? {}
        : { producer: artifact.producer }),
      ...(artifact.subjectDigest === undefined
        ? {}
        : { subjectDigest: artifact.subjectDigest }),
      ...(artifact.traceId === undefined ? {} : { traceId: artifact.traceId }),
      kind: artifact.kind,
      ...(artifact.label === undefined ? {} : { label: artifact.label }),
      storageProvider: artifact.storageProvider,
      storageKey: artifact.storageKey,
      contentType: artifact.contentType,
      sizeBytes: artifact.sizeBytes,
      sha256: artifact.sha256,
      ...(artifact.retentionPolicy === undefined
        ? {}
        : { retentionPolicy: artifact.retentionPolicy }),
      createdAt: artifact.createdAt,
    }
  },
})

const recordEvidenceArtifact = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    producer: v.optional(v.string()),
    subjectDigest: v.optional(v.string()),
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
      ...(args.producer === undefined ? {} : { producer: args.producer }),
      ...(args.subjectDigest === undefined
        ? {}
        : { subjectDigest: args.subjectDigest }),
      ...(args.traceId === undefined ? {} : { traceId: args.traceId }),
      kind: args.kind,
      ...(args.label === undefined ? {} : { label: args.label }),
      storageProvider: args.storageProvider,
      storageKey: args.storageKey,
      contentType: args.contentType,
      sizeBytes: args.sizeBytes,
      sha256: args.sha256,
      ...(args.retentionPolicy === undefined
        ? {}
        : { retentionPolicy: args.retentionPolicy }),
      createdAt,
    }
    const existingArtifact = await ctx.db
      .query('evidenceArtifacts')
      .withIndex('by_storage_key', (q) =>
        q
          .eq('storageProvider', args.storageProvider)
          .eq('storageKey', args.storageKey),
      )
      .unique()
    if (existingArtifact !== null) {
      if (
        existingArtifact.workflowRunId !== args.workflowRunId ||
        existingArtifact.producer !== args.producer ||
        existingArtifact.subjectDigest !== args.subjectDigest ||
        existingArtifact.traceId !== args.traceId ||
        existingArtifact.kind !== args.kind ||
        existingArtifact.label !== args.label ||
        existingArtifact.contentType !== args.contentType ||
        existingArtifact.sizeBytes !== args.sizeBytes ||
        existingArtifact.sha256 !== args.sha256 ||
        existingArtifact.retentionPolicy !== args.retentionPolicy
      ) {
        throw new ConvexError('Evidence artifact storage key conflict')
      }
      return {
        id: existingArtifact._id,
        workflowRunId: existingArtifact.workflowRunId,
        ...(existingArtifact.producer === undefined
          ? {}
          : { producer: existingArtifact.producer }),
        ...(existingArtifact.subjectDigest === undefined
          ? {}
          : { subjectDigest: existingArtifact.subjectDigest }),
        ...(existingArtifact.traceId === undefined
          ? {}
          : { traceId: existingArtifact.traceId }),
        kind: existingArtifact.kind,
        ...(existingArtifact.label === undefined
          ? {}
          : { label: existingArtifact.label }),
        storageProvider: existingArtifact.storageProvider,
        storageKey: existingArtifact.storageKey,
        contentType: existingArtifact.contentType,
        sizeBytes: existingArtifact.sizeBytes,
        sha256: existingArtifact.sha256,
        ...(existingArtifact.retentionPolicy === undefined
          ? {}
          : { retentionPolicy: existingArtifact.retentionPolicy }),
        createdAt: existingArtifact.createdAt,
      }
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

const recordSandboxExecution = mutation({
  args: {
    systemSecret: v.string(),
    workflowRunId: v.id('workflowRuns'),
    incomingDispatchToken: v.optional(v.string()),
    executionGroupId: v.optional(v.id('verificationExecutionGroups')),
    executionGroupClaimToken: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    provider: v.string(),
    sandboxId: v.string(),
    providerSessionId: v.optional(v.string()),
    providerCommandId: v.optional(v.string()),
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
    if (
      !isValidProviderProcessIdentityPair(
        args.providerSessionId,
        args.providerCommandId,
      ) ||
      !isEpochMillis(args.startedAt) ||
      !isEpochMillis(args.completedAt) ||
      args.completedAt < args.startedAt ||
      args.completedAt > Date.now() + 60_000
    ) {
      throw new ConvexError('Invalid sandbox execution timing')
    }
    if (workflowRun.modelVersion === 'v1') {
      const executionGroup =
        args.executionGroupId === undefined
          ? null
          : await ctx.db.get(
              'verificationExecutionGroups',
              args.executionGroupId,
            )
      if (
        executionGroup?.sandboxExecutionId !== undefined &&
        args.idempotencyKey !== undefined
      ) {
        const existing = await ctx.db.get(
          'sandboxExecutions',
          executionGroup.sandboxExecutionId,
        )
        if (
          existing !== null &&
          existing.idempotencyKey === args.idempotencyKey &&
          existing.workflowRunId === args.workflowRunId &&
          existing.executionGroupId === args.executionGroupId &&
          existing.provider === args.provider &&
          existing.sandboxId === args.sandboxId &&
          existing.providerSessionId === args.providerSessionId &&
          existing.providerCommandId === args.providerCommandId &&
          existing.command === args.command &&
          existing.status === args.status &&
          existing.exitCode === args.exitCode &&
          existing.stdout === args.stdout &&
          existing.stderr === args.stderr &&
          JSON.stringify(existing.policy) === JSON.stringify(args.policy) &&
          existing.startedAt === args.startedAt &&
          existing.completedAt === args.completedAt
        ) {
          return sandboxExecutionValue(existing)
        }
        throw new ConvexError('Sandbox execution idempotency key conflict')
      }
      if (
        workflowRun.candidateIdentityVersion === 'incoming-pr-v1' &&
        args.executionGroupId !== undefined &&
        (executionGroup === null ||
          executionGroup.workflowRunId !== args.workflowRunId ||
          executionGroup.claimToken !== args.executionGroupClaimToken ||
          executionGroup.status !== 'running' ||
          executionGroup.sandboxId !== args.sandboxId ||
          executionGroup.providerSessionId !== args.providerSessionId ||
          executionGroup.providerCommandId !== args.providerCommandId ||
          executionGroup.sandboxExecutionId !== undefined ||
          args.idempotencyKey !==
            `${String(args.executionGroupId)}:sandbox-execution` ||
          !(await isLatestWorkflowAttempt(ctx, workflowRun)))
      ) {
        throw new ConvexError(
          'Incoming PR sandbox execution requires its active execution group',
        )
      }
      if (
        workflowRun.candidateIdentityVersion === 'incoming-pr-v1' &&
        args.executionGroupId === undefined &&
        (workflowRun.incomingDispatchStartedAt === undefined ||
          workflowRun.incomingDispatchToken !== args.incomingDispatchToken ||
          workflowRun.incomingDispatchSandboxId !== args.sandboxId ||
          !(await isLatestWorkflowAttempt(ctx, workflowRun)))
      ) {
        throw new ConvexError(
          'Incoming PR sandbox execution requires its active started dispatch',
        )
      }
      if (workflowRun.status !== 'running') {
        throw new ConvexError(
          'V1 sandbox execution requires an active execution claim',
        )
      }
      if (args.executionGroupId === undefined) {
        const existingExecution = await ctx.db
          .query('sandboxExecutions')
          .withIndex('by_workflow_run', (q) =>
            q.eq('workflowRunId', args.workflowRunId),
          )
          .first()
        if (existingExecution !== null) {
          throw new ConvexError(
            'V1 workflow attempt already has a sandbox execution',
          )
        }
      }
    }

    const id = await ctx.db.insert('sandboxExecutions', {
      workflowRunId: args.workflowRunId,
      ...(args.executionGroupId === undefined
        ? {}
        : { executionGroupId: args.executionGroupId }),
      ...(args.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: args.idempotencyKey }),
      provider: args.provider,
      sandboxId: args.sandboxId,
      ...(args.providerSessionId === undefined
        ? {}
        : { providerSessionId: args.providerSessionId }),
      ...(args.providerCommandId === undefined
        ? {}
        : { providerCommandId: args.providerCommandId }),
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

    if (args.executionGroupId !== undefined) {
      await ctx.db.patch('verificationExecutionGroups', args.executionGroupId, {
        sandboxExecutionId: id,
      })
    }

    if (workflowRun.status === 'queued') {
      await ctx.db.patch('workflowRuns', args.workflowRunId, {
        status: 'running',
      })
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
      ...(args.executionGroupId === undefined
        ? {}
        : { executionGroupId: args.executionGroupId }),
      ...(args.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: args.idempotencyKey }),
      provider: args.provider,
      sandboxId: args.sandboxId,
      ...(args.providerSessionId === undefined
        ? {}
        : { providerSessionId: args.providerSessionId }),
      ...(args.providerCommandId === undefined
        ? {}
        : { providerCommandId: args.providerCommandId }),
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

const authorizeRuntimeControl = query({
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

export const runtimeEvidenceFunctions = {
  recordRuntimeEvents,
  recordRuntimeSessionStarted,
  markRuntimeSessionStatus,
  getActiveRuntimeSession,
  getEvidenceArtifact,
  recordEvidenceArtifact,
  recordSandboxExecution,
  authorizeRuntimeControl,
} as const
