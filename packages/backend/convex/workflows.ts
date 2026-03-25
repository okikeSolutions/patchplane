import { internalMutation, internalQuery, query } from './_generated/server'
import { v } from 'convex/values'
import {
  promptScopeValidator,
  runtimeEventTypeValidator,
  runtimeSessionStatusValidator,
  workflowRunStatusValidator,
} from './contracts'

export const beginWorkflowRunExecution = internalMutation({
  args: {
    workflowRunId: v.id('workflowRuns'),
  },
  returns: v.union(
    v.null(),
    v.object({
      promptRequestId: v.id('promptRequests'),
      runtimeSessionId: v.id('runtimeSessions'),
      startedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const workflowRun = await ctx.db.get("workflowRuns", args.workflowRunId)

    if (!workflowRun || workflowRun.status !== 'queued') {
      return null
    }

    const now = Date.now()

    await ctx.db.patch("workflowRuns", args.workflowRunId, {
      status: 'launching',
      startedAt: now,
      updatedAt: now,
    })

    const runtimeSessionId = await ctx.db.insert('runtimeSessions', {
      workflowRunId: args.workflowRunId,
      externalSessionId: undefined,
      sandboxProvider: workflowRun.sandboxProvider,
      runtimeProvider: workflowRun.runtimeProvider,
      status: 'launching',
      createdAt: now,
      updatedAt: now,
      startedAt: undefined,
      endedAt: undefined,
    })

    const promptRequest = await ctx.db.get("promptRequests", workflowRun.promptRequestId)

    if (promptRequest) {
      await ctx.db.patch("promptRequests", workflowRun.promptRequestId, {
        status: 'running',
        updatedAt: now,
      })
    }

    return {
      promptRequestId: workflowRun.promptRequestId,
      runtimeSessionId,
      startedAt: now,
    }
  },
})

export const getWorkflowRunExecutionInput = internalQuery({
  args: {
    workflowRunId: v.id('workflowRuns'),
    runtimeSessionId: v.id('runtimeSessions'),
  },
  returns: v.union(
    v.null(),
    v.object({
      workflowRunId: v.id('workflowRuns'),
      promptRequestId: v.id('promptRequests'),
      prompt: v.string(),
      scope: promptScopeValidator,
      runtimeSession: v.object({
        id: v.id('runtimeSessions'),
        workflowRunId: v.id('workflowRuns'),
        externalSessionId: v.optional(v.string()),
        sandboxProvider: v.string(),
        runtimeProvider: v.string(),
        status: runtimeSessionStatusValidator,
        createdAt: v.number(),
        updatedAt: v.number(),
        startedAt: v.optional(v.number()),
        endedAt: v.optional(v.number()),
      }),
      githubInstallationExternalId: v.optional(v.number()),
      workflowStatus: workflowRunStatusValidator,
      sandboxProvider: v.string(),
      runtimeProvider: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const workflowRun = await ctx.db.get("workflowRuns", args.workflowRunId)
    const runtimeSession = await ctx.db.get("runtimeSessions", args.runtimeSessionId)

    if (!workflowRun || !runtimeSession) {
      return null
    }

    const promptRequest = await ctx.db.get("promptRequests", workflowRun.promptRequestId)

    if (!promptRequest) {
      return null
    }

    const installation = workflowRun.githubInstallationId
      ? await ctx.db.get("githubInstallations", workflowRun.githubInstallationId)
      : null

    return {
      workflowRunId: args.workflowRunId,
      promptRequestId: workflowRun.promptRequestId,
      prompt: promptRequest.prompt,
      scope: promptRequest.scope,
      runtimeSession: {
        id: args.runtimeSessionId,
        workflowRunId: runtimeSession.workflowRunId,
        externalSessionId: runtimeSession.externalSessionId,
        sandboxProvider: runtimeSession.sandboxProvider,
        runtimeProvider: runtimeSession.runtimeProvider,
        status: runtimeSession.status,
        createdAt: runtimeSession.createdAt,
        updatedAt: runtimeSession.updatedAt,
        startedAt: runtimeSession.startedAt,
        endedAt: runtimeSession.endedAt,
      },
      githubInstallationExternalId: installation?.externalInstallationId,
      workflowStatus: workflowRun.status,
      sandboxProvider: workflowRun.sandboxProvider,
      runtimeProvider: workflowRun.runtimeProvider,
    }
  },
})

export const markWorkflowRunRunning = internalMutation({
  args: {
    workflowRunId: v.id('workflowRuns'),
    runtimeSessionId: v.id('runtimeSessions'),
    externalSessionId: v.string(),
    startedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("workflowRuns", args.workflowRunId, {
      status: 'running',
      updatedAt: args.startedAt,
    })

    await ctx.db.patch("runtimeSessions", args.runtimeSessionId, {
      externalSessionId: args.externalSessionId,
      status: 'running',
      startedAt: args.startedAt,
      updatedAt: args.startedAt,
    })

    return null
  },
})

export const appendRuntimeEvents = internalMutation({
  args: {
    events: v.array(
      v.object({
        requestId: v.id('promptRequests'),
        workflowRunId: v.optional(v.id('workflowRuns')),
        runtimeSessionId: v.optional(v.id('runtimeSessions')),
        type: runtimeEventTypeValidator,
        message: v.string(),
        createdAt: v.number(),
      }),
    ),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    for (const event of args.events) {
      await ctx.db.insert('runtimeEvents', event)
    }

    return args.events.length
  },
})

export const completeWorkflowRunExecution = internalMutation({
  args: {
    workflowRunId: v.id('workflowRuns'),
    runtimeSessionId: v.id('runtimeSessions'),
    completedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const workflowRun = await ctx.db.get("workflowRuns", args.workflowRunId)

    if (!workflowRun) {
      return null
    }

    await ctx.db.patch("workflowRuns", args.workflowRunId, {
      status: 'completed',
      completedAt: args.completedAt,
      updatedAt: args.completedAt,
    })

    await ctx.db.patch("runtimeSessions", args.runtimeSessionId, {
      status: 'completed',
      endedAt: args.completedAt,
      updatedAt: args.completedAt,
    })

    await ctx.db.patch("promptRequests", workflowRun.promptRequestId, {
      status: 'completed',
      updatedAt: args.completedAt,
    })

    return null
  },
})

export const failWorkflowRunExecution = internalMutation({
  args: {
    workflowRunId: v.id('workflowRuns'),
    runtimeSessionId: v.id('runtimeSessions'),
    failedAt: v.number(),
    errorMessage: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const workflowRun = await ctx.db.get("workflowRuns", args.workflowRunId)

    if (!workflowRun) {
      return null
    }

    await ctx.db.patch("workflowRuns", args.workflowRunId, {
      status: 'failed',
      completedAt: args.failedAt,
      updatedAt: args.failedAt,
    })

    await ctx.db.patch("runtimeSessions", args.runtimeSessionId, {
      status: 'failed',
      endedAt: args.failedAt,
      updatedAt: args.failedAt,
    })

    await ctx.db.patch("promptRequests", workflowRun.promptRequestId, {
      status: 'failed',
      updatedAt: args.failedAt,
    })

    await ctx.db.insert('runtimeEvents', {
      requestId: workflowRun.promptRequestId,
      workflowRunId: args.workflowRunId,
      runtimeSessionId: args.runtimeSessionId,
      type: 'session.failed',
      message: args.errorMessage,
      createdAt: args.failedAt,
    })

    return null
  },
})

export const getWorkflowRunSnapshot = query({
  args: {
    workflowRunId: v.id('workflowRuns'),
  },
  returns: v.union(
    v.null(),
    v.object({
      workflowRun: v.object({
        id: v.string(),
        status: workflowRunStatusValidator,
        sandboxProvider: v.string(),
        runtimeProvider: v.string(),
        createdAt: v.number(),
        updatedAt: v.number(),
        startedAt: v.optional(v.number()),
        completedAt: v.optional(v.number()),
      }),
      promptRequest: v.object({
        id: v.string(),
        prompt: v.string(),
        status: v.string(),
        scope: promptScopeValidator,
        createdAt: v.number(),
        updatedAt: v.number(),
      }),
      runtimeSession: v.union(
        v.null(),
        v.object({
          id: v.string(),
          externalSessionId: v.optional(v.string()),
          status: runtimeSessionStatusValidator,
          createdAt: v.number(),
          updatedAt: v.number(),
          startedAt: v.optional(v.number()),
          endedAt: v.optional(v.number()),
        }),
      ),
      recentEvents: v.array(
        v.object({
          id: v.string(),
          type: runtimeEventTypeValidator,
          message: v.string(),
          createdAt: v.number(),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const workflowRun = await ctx.db.get("workflowRuns", args.workflowRunId)

    if (!workflowRun) {
      return null
    }

    const promptRequest = await ctx.db.get("promptRequests", workflowRun.promptRequestId)

    if (!promptRequest) {
      return null
    }

    const runtimeSession = await ctx.db
      .query('runtimeSessions')
      .withIndex('by_workflow_run_id', (queryBuilder) =>
        queryBuilder.eq('workflowRunId', args.workflowRunId),
      )
      .order('desc')
      .first()

    const recentEvents = await ctx.db
      .query('runtimeEvents')
      .withIndex('by_workflow_run_id_created_at', (queryBuilder) =>
        queryBuilder.eq('workflowRunId', args.workflowRunId),
      )
      .order('desc')
      .take(20)

    return {
      workflowRun: {
        id: String(workflowRun._id),
        status: workflowRun.status,
        sandboxProvider: workflowRun.sandboxProvider,
        runtimeProvider: workflowRun.runtimeProvider,
        createdAt: workflowRun.createdAt,
        updatedAt: workflowRun.updatedAt,
        startedAt: workflowRun.startedAt,
        completedAt: workflowRun.completedAt,
      },
      promptRequest: {
        id: String(promptRequest._id),
        prompt: promptRequest.prompt,
        status: promptRequest.status,
        scope: promptRequest.scope,
        createdAt: promptRequest.createdAt,
        updatedAt: promptRequest.updatedAt,
      },
      runtimeSession: runtimeSession
        ? {
            id: String(runtimeSession._id),
            externalSessionId: runtimeSession.externalSessionId,
            status: runtimeSession.status,
            createdAt: runtimeSession.createdAt,
            updatedAt: runtimeSession.updatedAt,
            startedAt: runtimeSession.startedAt,
            endedAt: runtimeSession.endedAt,
          }
        : null,
      recentEvents: recentEvents.map((event) => ({
        id: String(event._id),
        type: event.type,
        message: event.message,
        createdAt: event.createdAt,
      })),
    }
  },
})
