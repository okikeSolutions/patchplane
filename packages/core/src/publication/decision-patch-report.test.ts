import { describe, expect, it } from '@effect/vitest'
import {
  makeHumanDecisionId,
  makePromptRequestId,
  makeSandboxExecutionId,
  makeSystemActorId,
  makeSystemWorkspaceId,
  makeWorkflowRunId,
} from '@patchplane/domain/ids'
import { decisionCheckConclusion, formatDecisionPatchReportComment } from './decision-patch-report'

const workflowRunId = makeWorkflowRunId('run-1')
const workflowStart = {
  promptRequest: {
    id: makePromptRequestId('prompt-1'),
    workspaceId: makeSystemWorkspaceId('workspace-1'),
    actorId: makeSystemActorId('actor-1'),
    traceId: 'trace-1',
    source: 'external' as const,
    prompt: 'Fix the issue.',
    status: 'created' as const,
    createdAt: 1,
  },
  workflowRun: {
    id: workflowRunId,
    promptRequestId: makePromptRequestId('prompt-1'),
    workspaceId: makeSystemWorkspaceId('workspace-1'),
    traceId: 'trace-1',
    status: 'reviewed' as const,
    createdAt: 1,
  },
}
const humanDecision = {
  id: makeHumanDecisionId('decision-1'),
  workflowRunId,
  actorId: makeSystemActorId('reviewer-1'),
  status: 'approved' as const,
  comment: 'The scoped risk is acceptable.',
  decidedAt: 3,
}
const sandboxExecution = {
  id: makeSandboxExecutionId('execution-1'),
  workflowRunId,
  provider: 'daytona',
  sandboxId: 'sandbox-1',
  command: 'pi --mode json',
  status: 'succeeded' as const,
  exitCode: 0,
  stdout: 'done',
  startedAt: 1,
  completedAt: 2,
}

describe('decision Patch Report publication', () => {
  it('does not turn approval and agent completion into a successful verification check', () => {
    expect(decisionCheckConclusion({ humanDecision, sandboxExecution })).toBe('neutral')

    const body = formatDecisionPatchReportComment({
      workflowStart,
      humanDecision,
      sandboxExecution,
    })
    expect(body).toContain('**Execution:** sandbox execution completed')
    expect(body).toContain('**Verification:** incomplete')
  })

  it('uses success only for durable passing verification without an override', () => {
    expect(decisionCheckConclusion({
      humanDecision,
      sandboxExecution,
      verification: { status: 'passed' },
    })).toBe('success')
    expect(decisionCheckConclusion({
      humanDecision: { ...humanDecision, verificationOverride: true },
      sandboxExecution,
      verification: { status: 'passed' },
    })).toBe('neutral')
  })

  it('keeps failed execution and rejected decisions blocking', () => {
    expect(decisionCheckConclusion({
      humanDecision,
      sandboxExecution: { ...sandboxExecution, status: 'failed', exitCode: 1 },
    })).toBe('failure')
    expect(decisionCheckConclusion({
      humanDecision: { ...humanDecision, status: 'rejected' },
      sandboxExecution,
    })).toBe('failure')
  })
})
