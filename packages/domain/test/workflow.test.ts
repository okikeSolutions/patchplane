import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import {
  MergeDecisionSchema,
  PromptRequestSchema,
  WorkflowRunSchema,
  statusLabels,
  workflowStatuses,
} from '../src/index'

const decodePromptRequest = Schema.decodeUnknownSync(PromptRequestSchema)
const decodeWorkflowRun = Schema.decodeUnknownSync(WorkflowRunSchema)
const decodeMergeDecision = Schema.decodeUnknownSync(MergeDecisionSchema)

describe('workflow domain', () => {
  test('covers every workflow status with a label', () => {
    expect(new Set(Object.keys(statusLabels))).toEqual(new Set(workflowStatuses))
  })

  test('decodes a prompt request with a manual source', () => {
    const promptRequest = decodePromptRequest({
      id: 'request_1',
      projectId: 'project_1',
      executionTargetId: 'manual',
      policyBundleId: 'default',
      createdByUserId: 'user_1',
      prompt: 'Review the latest changes',
      scope: {
        repoUrl: 'https://github.com/acme/repo',
        baseBranch: 'main',
        targetBranch: 'patchplane/review',
        includePaths: ['src'],
        excludePaths: ['dist'],
        intent: 'review',
      },
      source: {
        kind: 'manual',
      },
      status: 'queued',
      createdAt: 1_710_000_000_000,
      updatedAt: 1_710_000_000_000,
    })

    expect(promptRequest.source.kind).toBe('manual')
    expect(promptRequest.status).toBe('queued')
  })

  test('rejects an unsupported workflow run status', () => {
    expect(() =>
      decodeWorkflowRun({
        id: 'run_1',
        promptRequestId: 'request_1',
        sandboxProvider: 'daytona',
        runtimeProvider: 'pi-mono',
        status: 'pending',
        createdAt: 1_710_000_000_000,
        updatedAt: 1_710_000_000_000,
      }),
    ).toThrow()
  })

  test('decodes merge decisions and enforces merge decision statuses', () => {
    const decision = decodeMergeDecision({
      id: 'decision_1',
      workflowRunId: 'run_1',
      status: 'approved',
      reasons: ['All checks passed'],
      createdAt: 1_710_000_000_000,
    })

    expect(decision.status).toBe('approved')

    expect(() =>
      decodeMergeDecision({
        id: 'decision_2',
        workflowRunId: 'run_2',
        status: 'accepted',
        reasons: [],
        createdAt: 1_710_000_000_000,
      }),
    ).toThrow()
  })
})
