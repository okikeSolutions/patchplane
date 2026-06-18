import { describe, expect, it } from '@effect/vitest'
import { formatSandboxResultComment } from './sandbox-result-comment'
import { makePromptRequestId, makeSystemActorId, makeSystemWorkspaceId, makeWorkflowRunId } from '@patchplane/domain/ids'

describe('formatSandboxResultComment', () => {
  it('keeps untrusted command and output inside GitHub Markdown boundaries', () => {
    const body = formatSandboxResultComment({
      workflowStart: {
        promptRequest: {
          id: makePromptRequestId('prompt-1'),
          workspaceId: makeSystemWorkspaceId('workspace-1'),
          actorId: makeSystemActorId('actor-1'),
          traceId: 'trace-1',
          source: 'external',
          prompt: 'prompt',
          status: 'created',
          createdAt: 1,
        },
        workflowRun: {
          id: makeWorkflowRunId('run-1'),
          promptRequestId: makePromptRequestId('prompt-1'),
          workspaceId: makeSystemWorkspaceId('workspace-1'),
          traceId: 'trace-1',
          status: 'queued',
          createdAt: 1,
        },
      },
      sandboxExecution: {
        id: 'sandbox-exec-1',
        workflowRunId: makeWorkflowRunId('run-1'),
        provider: 'daytona',
        sandboxId: 'sandbox-1',
        command: 'echo `owned`',
        status: 'failed',
        exitCode: 1,
        stdout: 'before\n```md\ninjected\n```\nafter',
        startedAt: 1,
        completedAt: 2,
      },
    })

    expect(body).toContain('- Command: `echo \\`owned\\``')
    expect(body).toContain('`\u200b``md')
    expect(body).not.toContain('```md\ninjected')
  })
})
