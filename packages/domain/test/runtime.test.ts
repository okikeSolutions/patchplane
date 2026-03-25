import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import { RuntimeEventSchema, RuntimeSessionSchema } from '../src/index'

const decodeRuntimeSession = Schema.decodeUnknownSync(RuntimeSessionSchema)
const decodeRuntimeEvent = Schema.decodeUnknownSync(RuntimeEventSchema)

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
})
