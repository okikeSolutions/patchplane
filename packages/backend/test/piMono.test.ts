import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import type { RuntimeExecutionRequest } from '@patchplane/domain'
import { PiMonoRuntimeAdapter } from '../src/runtime/piMono'

function createRuntimeExecutionRequest(): RuntimeExecutionRequest {
  return {
    promptRequestId: 'request-1',
    session: {
      id: 'session-1',
      workflowRunId: 'workflow-1',
      sandboxProvider: 'daytona',
      runtimeProvider: 'pi-mono',
      status: 'queued',
      createdAt: 1,
      updatedAt: 1,
    },
    prompt: 'Inspect the repo',
    workingDirectory: 'workspace/workflow-1',
    env: {
      OPENAI_API_KEY: 'test-key',
    },
  }
}

describe('PiMonoRuntimeAdapter', () => {
  test('builds a JSON-mode ephemeral CLI execution plan', async () => {
    const adapter = new PiMonoRuntimeAdapter({ command: 'pi' })

    const plan = await Effect.runPromise(
      adapter.createExecutionPlan(createRuntimeExecutionRequest()),
    )

    expect(plan.command).toContain('pi --mode json --no-session "$PROMPT"')
    expect(plan.workingDirectory).toBe('workspace/workflow-1')
    expect(plan.env).toEqual({
      OPENAI_API_KEY: 'test-key',
    })
  })

  test('normalizes documented compaction events from the Pi JSON stream', async () => {
    const adapter = new PiMonoRuntimeAdapter({ command: 'pi' })
    const events = await Effect.runPromise(
      adapter.normalizeOutput(createRuntimeExecutionRequest(), {
        exitCode: 0,
        stdout: [
          JSON.stringify({
            type: 'session',
            id: 'pi-session-1',
            cwd: '/workspace',
          }),
          JSON.stringify({
            type: 'compaction_start',
            reason: 'threshold',
          }),
          JSON.stringify({
            type: 'compaction_end',
            reason: 'threshold',
            aborted: false,
          }),
          JSON.stringify({
            type: 'message_update',
            assistantMessageEvent: {
              type: 'text_delta',
              delta: 'Finished.',
            },
          }),
          JSON.stringify({
            type: 'agent_end',
          }),
        ].join('\n'),
        stderr: '',
      }),
    )

    expect(events.providerEvents.map((event) => event.eventType)).toEqual([
      'session',
      'compaction_start',
      'compaction_end',
      'message_update',
      'agent_end',
    ])
    expect(events.events.map((event) => event.type)).toEqual([
      'session.started',
      'artifact.emitted',
      'artifact.emitted',
      'artifact.emitted',
      'session.completed',
    ])
    expect(events.events.map((event) => event.message)).toEqual([
      'Pi session pi-session-1 attached in /workspace.',
      'Pi auto-compaction started: threshold.',
      'Pi auto-compaction completed.',
      'Finished.',
      'Pi agent completed.',
    ])
  })

  test('preserves meaningful whitespace in Pi text deltas', async () => {
    const adapter = new PiMonoRuntimeAdapter({ command: 'pi' })
    const events = await Effect.runPromise(
      adapter.normalizeOutput(createRuntimeExecutionRequest(), {
        exitCode: 0,
        stdout: [
          JSON.stringify({
            type: 'message_update',
            assistantMessageEvent: {
              type: 'text_delta',
              delta: '  hello world',
            },
          }),
          JSON.stringify({
            type: 'message_update',
            assistantMessageEvent: {
              type: 'text_delta',
              delta: '   ',
            },
          }),
        ].join('\n'),
        stderr: '',
      }),
    )

    expect(events.providerEvents).toHaveLength(2)
    expect(events.events).toHaveLength(1)
    expect(events.events[0]?.message).toBe('  hello world')
  })
})
