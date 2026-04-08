import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import type { RuntimeProviderEventInput } from '@patchplane/domain'
import { reviewRuntimeExecution } from '../src/policy/runtimeReview'

function createPiProviderEvent(
  payload: Record<string, unknown>,
  sequence = 0,
): RuntimeProviderEventInput {
  return {
    requestId: 'request_1',
    workflowRunId: 'run_1',
    runtimeSessionId: 'session_1',
    provider: 'pi-mono',
    eventType: String(payload.type ?? 'unknown'),
    stream: 'stdout',
    sequence,
    rawPayload: JSON.stringify(payload),
    providerTimestamp: undefined,
    createdAt: sequence + 1,
  }
}

describe('reviewRuntimeExecution', () => {
  test('approves a clean runtime execution for all configured automated reviewers', async () => {
    const outcome = await Effect.runPromise(
      reviewRuntimeExecution({
        requestId: 'request_1',
        policy: {
          requiredReviewers: ['quality', 'security'],
          minimumScore: 0.8,
        },
        normalizedEvents: [
          {
            requestId: 'request_1',
            type: 'session.started',
            message: 'started',
            createdAt: 1,
          },
          {
            requestId: 'request_1',
            type: 'session.completed',
            message: 'completed',
            createdAt: 2,
          },
        ],
        providerEvents: [],
      }),
    )

    expect(outcome.reviewRuns).toHaveLength(2)
    expect(outcome.reviewRuns.map((reviewRun) => reviewRun.reviewer)).toEqual([
      'quality',
      'security',
    ])
    expect(outcome.mergeDecision.status).toBe('approved')
    expect(outcome.pendingApproval).toBeUndefined()
    expect(outcome.pendingInputs).toHaveLength(0)
  })

  test('requests manual approval when an unknown reviewer is required', async () => {
    const outcome = await Effect.runPromise(
      reviewRuntimeExecution({
        requestId: 'request_1',
        policy: {
          requiredReviewers: ['quality', 'performance'],
          minimumScore: 0.8,
        },
        normalizedEvents: [
          {
            requestId: 'request_1',
            type: 'session.completed',
            message: 'completed',
            createdAt: 1,
          },
        ],
        providerEvents: [],
      }),
    )

    expect(outcome.reviewRuns).toHaveLength(1)
    expect(outcome.mergeDecision.status).toBe('pending')
    expect(outcome.pendingApproval?.kind).toBe('policy.manual_review')
    expect(outcome.pendingApproval?.body).toContain(
      'Missing required reviewers: performance.',
    )
  })

  test('requests operator input when runtime execution fails', async () => {
    const outcome = await Effect.runPromise(
      reviewRuntimeExecution({
        requestId: 'request_1',
        policy: {
          requiredReviewers: ['quality'],
          minimumScore: 0.8,
        },
        normalizedEvents: [
          {
            requestId: 'request_1',
            type: 'session.failed',
            message: 'runtime failed',
            createdAt: 1,
          },
        ],
        providerEvents: [],
      }),
    )

    expect(outcome.reviewRuns[0]?.passed).toBe(false)
    expect(outcome.pendingInputs).toHaveLength(1)
    expect(outcome.pendingInputs[0]?.kind).toBe('runtime.follow_up')
    expect(outcome.mergeDecision.status).toBe('pending')
  })

  test('fails the security reviewer when Pi reports a destructive bash command', async () => {
    const outcome = await Effect.runPromise(
      reviewRuntimeExecution({
        requestId: 'request_1',
        policy: {
          requiredReviewers: ['quality', 'security'],
          minimumScore: 0.8,
        },
        normalizedEvents: [
          {
            requestId: 'request_1',
            type: 'session.completed',
            message: 'completed',
            createdAt: 1,
          },
        ],
        providerEvents: [
          createPiProviderEvent({
            type: 'tool_execution_start',
            toolName: 'bash',
            args: {
              label: 'cleanup',
              command: 'rm -rf dist && echo done',
            },
          }),
        ],
      }),
    )

    expect(outcome.reviewRuns).toHaveLength(2)
    expect(
      outcome.reviewRuns.find((reviewRun) => reviewRun.reviewer === 'security')
        ?.passed,
    ).toBe(false)
    expect(outcome.pendingApproval?.body).toContain(
      'At least one review run failed.',
    )
    expect(outcome.mergeDecision.status).toBe('pending')
  })

  test('flags the quality reviewer when Pi reports a tool execution error', async () => {
    const outcome = await Effect.runPromise(
      reviewRuntimeExecution({
        requestId: 'request_1',
        policy: {
          requiredReviewers: ['quality'],
          minimumScore: 0.8,
        },
        normalizedEvents: [
          {
            requestId: 'request_1',
            type: 'session.completed',
            message: 'completed',
            createdAt: 1,
          },
        ],
        providerEvents: [
          createPiProviderEvent({
            type: 'tool_execution_end',
            toolName: 'bash',
            isError: true,
            result: {
              content: [{ type: 'text', text: 'command exited with code 1' }],
            },
          }),
        ],
      }),
    )

    expect(outcome.reviewRuns).toHaveLength(1)
    expect(outcome.reviewRuns[0]?.reviewer).toBe('quality')
    expect(outcome.reviewRuns[0]?.passed).toBe(false)
    expect(outcome.pendingApproval?.body).toContain(
      'At least one review run failed.',
    )
    expect(outcome.mergeDecision.status).toBe('pending')
  })

  test('ignores cleared queue updates when the latest queue state is empty', async () => {
    const outcome = await Effect.runPromise(
      reviewRuntimeExecution({
        requestId: 'request_1',
        policy: {
          requiredReviewers: ['quality'],
          minimumScore: 0.8,
        },
        normalizedEvents: [
          {
            requestId: 'request_1',
            type: 'session.completed',
            message: 'completed',
            createdAt: 1,
          },
        ],
        providerEvents: [
          createPiProviderEvent(
            {
              type: 'queue_update',
              followUp: ['Ask the operator about the next step.'],
            },
            1,
          ),
          createPiProviderEvent(
            {
              type: 'queue_update',
              followUp: [],
              steering: [],
            },
            2,
          ),
        ],
      }),
    )

    expect(outcome.pendingInputs).toHaveLength(0)
    expect(outcome.pendingApproval).toBeUndefined()
    expect(outcome.mergeDecision.status).toBe('approved')
  })
})
