import { assert, describe, it } from '@effect/vitest'
import { Schema } from 'effect'
import { WorkflowRun } from './workflow-run'

const decode = Schema.decodeUnknownSync(WorkflowRun)
const run = {
  id: 'run-1',
  promptRequestId: 'prompt-1',
  workspaceId: 'system:workspace-1',
  traceId: 'trace-1',
  status: 'queued',
  modelVersion: 'v1',
  rootWorkflowRunId: 'run-1',
  attemptNumber: 1,
  trigger: 'intake',
  sourceCommitSha: 'a'.repeat(40),
  createdAt: 1,
} as const

describe('WorkflowRun candidate identity compatibility', () => {
  it('accepts legacy V1 rows without a base SHA or identity version', () => {
    assert.isUndefined(decode(run).candidateIdentityVersion)
  })

  it('requires both revisions for incoming-pr-v1 attempts', () => {
    assert.throws(() =>
      decode({ ...run, candidateIdentityVersion: 'incoming-pr-v1' }),
    )
    assert.throws(() =>
      decode({
        ...run,
        modelVersion: undefined,
        candidateIdentityVersion: 'incoming-pr-v1',
        sourceBaseSha: 'b'.repeat(40),
      }),
    )
    for (const field of [
      'rootWorkflowRunId',
      'attemptNumber',
      'trigger',
    ] as const) {
      assert.throws(() =>
        decode({
          ...run,
          candidateIdentityVersion: 'incoming-pr-v1',
          sourceBaseSha: 'b'.repeat(40),
          [field]: undefined,
        }),
      )
    }
    const current = decode({
      ...run,
      candidateIdentityVersion: 'incoming-pr-v1',
      sourceBaseSha: 'b'.repeat(40),
    })
    assert.strictEqual(current.sourceBaseSha, 'b'.repeat(40))
    assert.strictEqual(current.sourceCommitSha, 'a'.repeat(40))
  })
})
