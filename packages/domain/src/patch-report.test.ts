import { describe, expect, it } from '@effect/vitest'
import { assemblePatchReportV0 } from './patch-report'
import { makePromptRequestId, makeSystemActorId, makeSystemWorkspaceId, makeWorkflowRunId } from './ids'
import type { RuntimeEvent } from './runtime-event'
import type { RuntimeSession } from './runtime-session'
import type { SandboxExecution } from './sandbox-execution'
import type { WorkflowStart } from './workflow-start'

const workflowRunId = makeWorkflowRunId('workflow-1')
const promptRequestId = makePromptRequestId('prompt-1')
const workspaceId = makeSystemWorkspaceId('workspace-1')

const workflowStart: WorkflowStart = {
  promptRequest: {
    id: promptRequestId,
    workspaceId,
    actorId: makeSystemActorId('actor-1'),
    traceId: 'trace-1',
    source: 'external',
    prompt: 'Fix the failing tests and explain the evidence.',
    externalRef: {
      provider: 'github',
      deliveryId: 'delivery-1',
      eventKind: 'issue_comment',
      repositoryFullName: 'patchplane/demo',
    },
    status: 'created',
    createdAt: 1,
  },
  workflowRun: {
    id: workflowRunId,
    promptRequestId,
    workspaceId,
    traceId: 'trace-1',
    status: 'reviewed',
    createdAt: 2,
  },
}

const runtimeEvent: RuntimeEvent = {
  id: 'event-1',
  workflowRunId,
  provider: 'pi',
  type: 'agent.started',
  occurredAt: 3,
  summary: 'Agent started',
}

const runtimeSession: RuntimeSession = {
  id: 'session-1',
  workflowRunId,
  provider: 'daytona:pi-rpc',
  sandboxId: 'sandbox-1',
  sessionId: 'session-1',
  commandId: 'command-1',
  status: 'completed',
  startedAt: 3,
  updatedAt: 4,
  completedAt: 5,
}

const sandboxExecution: SandboxExecution = {
  id: 'sandbox-execution-1',
  workflowRunId,
  provider: 'daytona',
  sandboxId: 'sandbox-1',
  command: 'bun test',
  status: 'succeeded',
  exitCode: 0,
  stdout: 'ok',
  startedAt: 4,
  completedAt: 6,
}

describe('assemblePatchReportV0', () => {
  it('assembles a verification-passed report from existing workflow evidence', () => {
    const report = assemblePatchReportV0({
      workflowStart,
      runtimeEvents: [runtimeEvent],
      runtimeSessions: [runtimeSession],
      sandboxExecutions: [sandboxExecution],
    })

    expect(report).toMatchObject({
      id: 'patch-report:workflow-1',
      workflowRunId: workflowRunId,
      status: 'verification-passed',
      repository: 'patchplane/demo',
      promptSummary: 'Fix the failing tests and explain the evidence.',
      execution: {
        sandboxProvider: 'daytona',
        sandboxId: 'sandbox-1',
        command: 'bun test',
        status: 'passed',
        exitCode: 0,
        startedAt: 4,
        completedAt: 6,
      },
      checks: [{ name: 'bun test', status: 'passed', summary: 'exit 0' }],
      evidence: [
        { kind: 'runtime-event', label: 'Agent started', summary: 'pi · agent.started' },
        { kind: 'stdout', label: 'Sandbox stdout', summary: '2 bytes inline in sandbox execution' },
      ],
      createdAt: 2,
      updatedAt: 6,
    })
  })

  it('reports pending when no sandbox verification has run', () => {
    const report = assemblePatchReportV0({
      workflowStart,
      runtimeEvents: [],
      runtimeSessions: [],
      sandboxExecutions: [],
    })

    expect(report.status).toBe('pending')
    expect(report.execution).toEqual({ status: 'not-run' })
    expect(report.checks).toEqual([])
    expect(report.evidence).toEqual([])
  })

  it('uses the latest sandbox execution for verification status', () => {
    const olderFailure: SandboxExecution = {
      ...sandboxExecution,
      id: 'sandbox-execution-older',
      status: 'failed',
      exitCode: 1,
      startedAt: 1,
      completedAt: 2,
    }

    const report = assemblePatchReportV0({
      workflowStart,
      runtimeEvents: [],
      runtimeSessions: [],
      sandboxExecutions: [olderFailure, sandboxExecution],
    })

    expect(report.status).toBe('verification-passed')
    expect(report.execution.exitCode).toBe(0)
  })
})
