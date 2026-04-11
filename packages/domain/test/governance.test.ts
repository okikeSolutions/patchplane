import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import {
  ExecutionTargetSchema,
  MergeDecisionSchema,
  PendingApprovalSchema,
  PendingInputSchema,
  PolicyBundleSchema,
} from '../src/index'

const decodeExecutionTarget = Schema.decodeUnknownSync(ExecutionTargetSchema)
const decodePolicyBundle = Schema.decodeUnknownSync(PolicyBundleSchema)
const decodePendingApproval = Schema.decodeUnknownSync(PendingApprovalSchema)
const decodePendingInput = Schema.decodeUnknownSync(PendingInputSchema)
const decodeMergeDecision = Schema.decodeUnknownSync(MergeDecisionSchema)

describe('governance domain', () => {
  test('decodes execution targets and policy bundles', () => {
    const executionTarget = decodeExecutionTarget({
      id: 'target_1',
      projectId: 'project_1',
      key: 'github.issue_comment',
      sandboxProvider: 'daytona',
      runtimeProvider: 'pi-mono',
      enabled: true,
      createdAt: 1_710_000_000_000,
      updatedAt: 1_710_000_000_000,
    })
    const policyBundle = decodePolicyBundle({
      id: 'policy_1',
      projectId: 'project_1',
      key: 'default',
      requiredReviewers: ['quality'],
      minimumScore: 0.8,
      enabled: true,
      createdAt: 1_710_000_000_000,
      updatedAt: 1_710_000_000_000,
    })

    expect(executionTarget.key).toBe('github.issue_comment')
    expect(policyBundle.minimumScore).toBe(0.8)
  })

  test('decodes pending approvals and inputs', () => {
    const approval = decodePendingApproval({
      id: 'approval_1',
      promptRequestId: 'request_1',
      workflowRunId: 'run_1',
      kind: 'runtime.interrupt',
      title: 'Approve sandbox escalation',
      status: 'pending',
      requestedByUserId: 'system',
      createdAt: 1_710_000_000_000,
      updatedAt: 1_710_000_000_000,
    })
    const input = decodePendingInput({
      id: 'input_1',
      promptRequestId: 'request_1',
      workflowRunId: 'run_1',
      kind: 'clarification',
      prompt: 'Choose a target branch.',
      status: 'pending',
      requestedByUserId: 'system',
      createdAt: 1_710_000_000_000,
      updatedAt: 1_710_000_000_000,
    })

    expect(approval.status).toBe('pending')
    expect(input.prompt).toBe('Choose a target branch.')
  })

  test('decodes merge decisions with workflow lineage', () => {
    const decision = decodeMergeDecision({
      id: 'decision_1',
      workflowRunId: 'run_1',
      policyBundleId: 'policy_1',
      status: 'approved',
      reasons: ['All checks passed'],
      decidedByUserId: 'reviewer_1',
      createdAt: 1_710_000_000_000,
      updatedAt: 1_710_000_005_000,
      decidedAt: 1_710_000_005_000,
    })

    expect(String(decision.policyBundleId)).toBe('policy_1')
    expect(decision.status).toBe('approved')
  })
})
