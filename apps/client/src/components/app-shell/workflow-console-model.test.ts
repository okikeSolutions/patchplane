import { describe, expect, test, vi } from 'vitest'
import type { WorkflowStartRow } from './types'
import {
  formatRelative,
  workflowContextLabel,
  workflowDisplayTitle,
  workflowUpdatedAt,
} from './workflow-console-model'

vi.mock('@/paraglide/runtime', () => ({
  getLocale: () => 'de',
}))

describe('workflow console model', () => {
  test('formats relative time in the active app locale', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-27T12:00:00.000Z'))

    expect(formatRelative(Date.parse('2026-06-18T12:00:00.000Z'))).toBe(
      'vor 9 Tagen',
    )

    vi.useRealTimers()
  })

  test('uses the separately persisted GitHub pull request title', () => {
    const row = workflowRow(
      'Incorrect concatenated prompt\n\n# Summary\nBody',
      {
        eventKind: 'github.pull_request.synchronize',
        issueTitle: 'feat(agent): make local runs discoverable and verifiable',
        pullRequestNumber: 128,
      },
    )

    expect(workflowDisplayTitle(row)).toBe(
      'feat(agent): make local runs discoverable and verifiable',
    )
  })

  test('formats compact source context and uses the latest projected update', () => {
    const row = workflowRow('Review the patch', {
      pullRequestNumber: 128,
    })
    row.workflowRun.attemptNumber = 2
    row.workflowRun.updatedAt = 42

    expect(workflowContextLabel(row)).toBe(
      'okikeSolutions/guerillaglass · PR #128 · Attempt 2',
    )
    expect(workflowUpdatedAt(row)).toBe(42)
  })

  test('uses the first prompt line for legacy GitHub pull request records', () => {
    const row = workflowRow(
      'feat(agent): make local runs discoverable and verifiable\n\n# Summary\nBody',
      {
        eventKind: 'github.pull_request.opened',
        pullRequestNumber: 128,
      },
    )

    expect(workflowDisplayTitle(row)).toBe(
      'feat(agent): make local runs discoverable and verifiable',
    )
  })

  test('does not truncate multiline app prompts in the source model', () => {
    const row = workflowRow(
      'Investigate the failure\nand preserve the evidence',
    )
    row.promptRequest.source = 'app'
    row.promptRequest.externalRef = undefined

    expect(workflowDisplayTitle(row)).toBe(
      'Investigate the failure\nand preserve the evidence',
    )
  })
})

function workflowRow(
  prompt: string,
  externalRef?: Partial<
    NonNullable<WorkflowStartRow['promptRequest']['externalRef']>
  >,
): WorkflowStartRow {
  return {
    promptRequest: {
      id: 'prompt-1',
      workspaceId: 'workos:org-1',
      actorId: 'github:octocat',
      traceId: 'trace-1',
      source: 'external',
      prompt,
      externalRef: {
        provider: 'github',
        deliveryId: 'delivery-1',
        eventKind: 'github.pull_request.opened',
        repositoryFullName: 'okikeSolutions/guerillaglass',
        ...externalRef,
      },
      status: 'created',
      createdAt: 1,
    },
    workflowRun: {
      id: 'run-1',
      promptRequestId: 'prompt-1',
      workspaceId: 'workos:org-1',
      traceId: 'trace-1',
      status: 'queued',
      createdAt: 2,
    },
  }
}
