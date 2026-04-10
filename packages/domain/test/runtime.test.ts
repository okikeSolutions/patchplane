import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import {
  RuntimeEventSchema,
  RuntimeExecutionRequestSchema,
  RuntimeNormalizationResultSchema,
  RuntimeProviderEventSchema,
  RuntimeSessionSchema,
  SandboxExecutionResultSchema,
} from '../src/index'

const decodeRuntimeSession = Schema.decodeUnknownSync(RuntimeSessionSchema)
const decodeRuntimeEvent = Schema.decodeUnknownSync(RuntimeEventSchema)
const decodeRuntimeNormalizationResult = Schema.decodeUnknownSync(
  RuntimeNormalizationResultSchema,
)
const decodeRuntimeProviderEvent = Schema.decodeUnknownSync(
  RuntimeProviderEventSchema,
)
const decodeRuntimeExecutionRequest = Schema.decodeUnknownSync(
  RuntimeExecutionRequestSchema,
)
const decodeSandboxExecutionResult = Schema.decodeUnknownSync(
  SandboxExecutionResultSchema,
)

describe('runtime domain', () => {
  test('decodes runtime sessions with optional timestamps', () => {
    const session = decodeRuntimeSession({
      id: 'session_1',
      workflowRunId: 'run_1',
      externalSessionId: 'external_1',
      sandboxProvider: 'daytona',
      runtimeProvider: 'pi-mono',
      status: 'running',
      createdAt: 1_710_000_000_000,
      updatedAt: 1_710_000_010_000,
      startedAt: 1_710_000_005_000,
    })

    expect(session.status).toBe('running')
    expect(session.externalSessionId).toBe('external_1')
  })

  test('decodes runtime events for shared timeline projection', () => {
    const event = decodeRuntimeEvent({
      id: 'event_1',
      requestId: 'request_1',
      workflowRunId: 'run_1',
      runtimeSessionId: 'session_1',
      type: 'tool.called',
      message: 'git status',
      createdAt: 1_710_000_000_000,
    })

    expect(event.type).toBe('tool.called')
    expect(event.message).toBe('git status')
  })

  test('decodes raw provider runtime events for lossless persistence', () => {
    const event = decodeRuntimeProviderEvent({
      id: 'provider_event_1',
      requestId: 'request_1',
      workflowRunId: 'run_1',
      runtimeSessionId: 'session_1',
      provider: 'pi-mono',
      eventType: 'message_update',
      stream: 'stdout',
      sequence: 3,
      rawPayload:
        '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"hello"}}',
      providerTimestamp: '2026-04-03T12:00:00.000Z',
      createdAt: 1_710_000_000_003,
    })

    expect(event.provider).toBe('pi-mono')
    expect(event.eventType).toBe('message_update')
    expect(event.stream).toBe('stdout')
  })

  test('rejects unsupported runtime event types', () => {
    expect(() =>
      decodeRuntimeEvent({
        id: 'event_2',
        requestId: 'request_1',
        type: 'tool.completed',
        message: 'git status',
        createdAt: 1_710_000_000_000,
      }),
    ).toThrow()
  })

  test('decodes runtime execution requests with forwarded environment', () => {
    const executionRequest = decodeRuntimeExecutionRequest({
      promptRequestId: 'request_1',
      session: {
        id: 'session_1',
        workflowRunId: 'run_1',
        sandboxProvider: 'daytona',
        runtimeProvider: 'pi-mono',
        status: 'launching',
        createdAt: 1_710_000_000_000,
        updatedAt: 1_710_000_001_000,
      },
      prompt: 'Fix the flaky test',
      workingDirectory: 'workspace/run_1',
      env: {
        OPENAI_API_KEY: 'token',
      },
    })

    expect(executionRequest.env.OPENAI_API_KEY).toBe('token')
    expect(executionRequest.session.status).toBe('launching')
  })

  test('decodes sandbox execution results before persistence', () => {
    const result = decodeSandboxExecutionResult({
      externalSessionId: 'sandbox-1:patchplane-session_1',
      providerEvents: [
        {
          requestId: 'request_1',
          workflowRunId: 'run_1',
          runtimeSessionId: 'session_1',
          provider: 'pi-mono',
          eventType: 'turn_start',
          stream: 'stdout',
          sequence: 0,
          rawPayload: '{"type":"turn_start"}',
          createdAt: 1_710_000_000_000,
        },
      ],
      events: [
        {
          requestId: 'request_1',
          workflowRunId: 'run_1',
          runtimeSessionId: 'session_1',
          type: 'session.started',
          message: 'Execution started.',
          createdAt: 1_710_000_000_000,
        },
      ],
    })

    expect(result.externalSessionId).toBe('sandbox-1:patchplane-session_1')
    expect(result.providerEvents).toHaveLength(1)
    expect(result.events).toHaveLength(1)
  })

  test('decodes runtime normalization results with raw and normalized events', () => {
    const result = decodeRuntimeNormalizationResult({
      providerEvents: [
        {
          requestId: 'request_1',
          provider: 'pi-mono',
          eventType: 'agent_end',
          stream: 'stdout',
          sequence: 1,
          rawPayload: '{"type":"agent_end"}',
          createdAt: 1_710_000_000_001,
        },
      ],
      events: [
        {
          requestId: 'request_1',
          type: 'session.completed',
          message: 'Pi agent completed.',
          createdAt: 1_710_000_000_001,
        },
      ],
    })

    expect(result.providerEvents).toHaveLength(1)
    expect(result.events).toHaveLength(1)
  })
})
