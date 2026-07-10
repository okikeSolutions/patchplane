import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { makeWorkflowRunId } from '@patchplane/domain/ids'
import { SandboxService } from '../services/sandbox-service'
import { StorageService } from '../services/storage-service'
import { AbortRuntimeSession, FollowUpRuntimeSession, SteerRuntimeSession, TerminateRuntimeSession } from './control-runtime-session'

const activeSession = {
  id: 'runtime-1',
  workflowRunId: makeWorkflowRunId('workflow-1'),
  provider: 'daytona:pi-rpc',
  sandboxId: 'sandbox-1',
  sessionId: 'session-1',
  commandId: 'cmd-1',
  status: 'running' as const,
  startedAt: 1,
  updatedAt: 1,
}

function storageLayer(events: Array<unknown>, session = activeSession) {
  return Layer.succeed(StorageService, StorageService.of({
    createWorkflowFromIntake: () => Effect.die('unused'),
    createWorkflowFromPrompt: () => Effect.die('unused'),
    listRecentWorkflowStarts: () => Effect.die('unused'),
    recordSandboxExecution: () => Effect.die('unused'),
    recordRuntimeEvents: () => Effect.die('unused'),
    recordRuntimeSessionStarted: () => Effect.die('unused'),
    getActiveRuntimeSession: () => Effect.succeed(session),
    recordEvidenceArtifact: () => Effect.die('unused'),
    getEvidenceArtifact: () => Effect.die('unused'),
    recordCandidatePatchSet: () => Effect.die('unused'),
    recordReviewRun: () => Effect.die('unused'),
    recordReviewFinding: () => Effect.die('unused'),
    recordPolicyDecision: () => Effect.die('unused'),
    recordPublicationResult: () => Effect.die('unused'),
    recordProvenanceEvent: () => Effect.die('unused'),
    markRuntimeSessionStatus: (input) => Effect.sync(() => {
      events.push(input)
      return { ...session, status: input.status, updatedAt: 2, ...(input.completedAt === undefined ? {} : { completedAt: input.completedAt }) }
    }),
  }))
}

function sandboxLayer(events: Array<unknown>) {
  return Layer.succeed(SandboxService, SandboxService.of({
    runRepositoryAgent: () => Effect.die('unused'),
    runRepositoryCommand: () => Effect.die('unused'),
    abortRuntimeSession: (input) => Effect.sync(() => {
      events.push({ operation: 'abort', input })
      return { provider: 'daytona:pi-rpc', sandboxId: input.sandboxId, sessionId: input.sessionId, commandId: input.commandId, status: 'sent' as const }
    }),
    steerRuntimeSession: (input) => Effect.sync(() => {
      events.push({ operation: 'steer', input })
      return { provider: 'daytona:pi-rpc', sandboxId: input.sandboxId, sessionId: input.sessionId, commandId: input.commandId, status: 'sent' as const }
    }),
    followUpRuntimeSession: (input) => Effect.sync(() => {
      events.push({ operation: 'followUp', input })
      return { provider: 'daytona:pi-rpc', sandboxId: input.sandboxId, sessionId: input.sessionId, commandId: input.commandId, status: 'sent' as const }
    }),
    terminateRuntimeSession: (input) => Effect.sync(() => {
      events.push({ operation: 'terminate', input })
      return { provider: 'daytona:pi-rpc', sandboxId: input.sandboxId, sessionId: input.sessionId, commandId: input.commandId, status: 'terminated' as const }
    }),
  }))
}

const input = { workflowRunId: activeSession.workflowRunId, traceId: 'trace-1' }

describe('ControlRuntimeSession workflows', () => {
  it.effect('sends soft abort and marks the runtime session cancelled', () =>
    Effect.gen(function* () {
      const events: Array<unknown> = []
      const result = yield* AbortRuntimeSession(input).pipe(
        Effect.provide(Layer.mergeAll(storageLayer(events), sandboxLayer(events))),
      )

      expect(result.status).toBe('sent')
      expect(events).toEqual([
        expect.objectContaining({ operation: 'abort' }),
        expect.objectContaining({ status: 'cancelled' }),
      ])
    }))

  it.effect('sends steer and follow-up without completing the session', () =>
    Effect.gen(function* () {
      const events: Array<unknown> = []
      yield* SteerRuntimeSession({ ...input, message: 'change course' }).pipe(
        Effect.provide(Layer.mergeAll(storageLayer(events), sandboxLayer(events))),
      )
      yield* FollowUpRuntimeSession({ ...input, message: 'then summarize' }).pipe(
        Effect.provide(Layer.mergeAll(storageLayer(events), sandboxLayer(events))),
      )

      expect(events).toEqual([
        expect.objectContaining({ operation: 'steer' }),
        expect.objectContaining({ operation: 'followUp' }),
      ])
    }))

  it.effect('hard terminates and marks the runtime session cancelled', () =>
    Effect.gen(function* () {
      const events: Array<unknown> = []
      const result = yield* TerminateRuntimeSession(input).pipe(
        Effect.provide(Layer.mergeAll(storageLayer(events), sandboxLayer(events))),
      )

      expect(result.status).toBe('terminated')
      expect(events).toEqual([
        expect.objectContaining({ operation: 'terminate' }),
        expect.objectContaining({ status: 'cancelled' }),
      ])
    }))
})
