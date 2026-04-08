import { Effect } from 'effect'
import {
  BoundaryFailure,
  type RuntimeAdapter,
  type RuntimeEnvironment,
  type RuntimeEventInput,
  type RuntimeExecutionOutput,
  type RuntimeExecutionPlan,
  type RuntimeExecutionRequest,
  type RuntimeNormalizationResult,
  type RuntimeProviderEventInput,
} from '@patchplane/domain'

export interface PiMonoRuntimeOptions {
  readonly command: string
}

interface PiJsonAssistantMessageEvent {
  readonly type?: string
  readonly delta?: string
}

interface PiJsonEvent {
  readonly type?: string
  readonly timestamp?: string
  readonly cwd?: string
  readonly id?: string
  readonly toolName?: string
  readonly isError?: boolean
  readonly errorMessage?: string
  readonly finalError?: string
  readonly attempt?: number
  readonly maxAttempts?: number
  readonly delayMs?: number
  readonly reason?: string
  readonly aborted?: boolean
  readonly willRetry?: boolean
  readonly assistantMessageEvent?: PiJsonAssistantMessageEvent
}

const PI_MONO_PROVIDER = 'pi-mono'

function toBoundaryFailure(message: string, cause: unknown): BoundaryFailure {
  return new BoundaryFailure({
    boundary: 'runtime.pi-mono',
    message,
    retryable: false,
    cause,
  })
}

function toExecutionMessage(event: PiJsonEvent): string | null {
  switch (event.type) {
    case 'session':
      return event.id
        ? `Pi session ${event.id} attached${event.cwd ? ` in ${event.cwd}` : ''}.`
        : 'Pi session attached.'
    case 'turn_start':
      return 'Pi turn started.'
    case 'turn_end':
      return 'Pi turn completed.'
    case 'tool_execution_start':
      return event.toolName
        ? `Pi tool started: ${event.toolName}.`
        : 'Pi tool started.'
    case 'tool_execution_end':
      return event.isError
        ? `Pi tool failed${event.toolName ? `: ${event.toolName}` : ''}.`
        : event.toolName
          ? `Pi tool completed: ${event.toolName}.`
          : 'Pi tool completed.'
    case 'auto_retry_start':
      return `Pi auto-retry started (attempt ${event.attempt ?? '?'} of ${event.maxAttempts ?? '?'}).`
    case 'auto_retry_end':
      return event.finalError
        ? `Pi auto-retry ended with error: ${event.finalError}`
        : 'Pi auto-retry ended.'
    case 'compaction_start':
    case 'auto_compaction_start':
      return `Pi auto-compaction started${event.reason ? `: ${event.reason}` : ''}.`
    case 'compaction_end':
    case 'auto_compaction_end':
      return event.aborted
        ? 'Pi auto-compaction aborted.'
        : 'Pi auto-compaction completed.'
    case 'message_update':
      return event.assistantMessageEvent?.type === 'text_delta' &&
        event.assistantMessageEvent.delta &&
        event.assistantMessageEvent.delta.trim().length > 0
        ? event.assistantMessageEvent.delta
        : null
    case 'agent_end':
      return 'Pi agent completed.'
    default:
      return null
  }
}

function toRuntimeEventType(
  event: PiJsonEvent,
): RuntimeEventInput['type'] | null {
  switch (event.type) {
    case 'session':
      return 'session.started'
    case 'turn_start':
      return 'turn.started'
    case 'turn_end':
      return 'turn.completed'
    case 'tool_execution_start':
      return 'tool.called'
    case 'tool_execution_end':
      return event.isError ? 'turn.failed' : 'artifact.emitted'
    case 'compaction_start':
    case 'compaction_end':
    case 'auto_retry_start':
    case 'auto_retry_end':
    case 'auto_compaction_start':
    case 'auto_compaction_end':
    case 'message_update':
      return 'artifact.emitted'
    case 'agent_end':
      return 'session.completed'
    default:
      return null
  }
}

function parsePiEventLines(
  request: RuntimeExecutionRequest,
  output: RuntimeExecutionOutput,
): RuntimeNormalizationResult {
  const baseCreatedAt = Date.now()
  const providerEvents: RuntimeProviderEventInput[] = []
  const events: RuntimeEventInput[] = []
  let sequence = 0
  const stdoutLines = output.stdout.split('\n')

  for (const rawStdoutLine of stdoutLines) {
    const line = rawStdoutLine.replace(/\r$/, '')
    const trimmedLine = line.trim()

    if (trimmedLine.length === 0) {
      continue
    }

    const createdAt = baseCreatedAt + sequence

    try {
      const event = JSON.parse(trimmedLine) as PiJsonEvent
      const eventType =
        typeof event.type === 'string' && event.type.length > 0
          ? event.type
          : 'unknown'
      const type = toRuntimeEventType(event)
      const message = toExecutionMessage(event)

      providerEvents.push({
        requestId: request.promptRequestId,
        workflowRunId: request.session.workflowRunId,
        runtimeSessionId: request.session.id,
        provider: PI_MONO_PROVIDER,
        eventType,
        stream: 'stdout',
        sequence,
        rawPayload: line,
        providerTimestamp: event.timestamp,
        createdAt,
      })

      if (type && message) {
        events.push({
          requestId: request.promptRequestId,
          workflowRunId: request.session.workflowRunId,
          runtimeSessionId: request.session.id,
          type,
          message,
          createdAt,
        })
      }
    } catch {
      providerEvents.push({
        requestId: request.promptRequestId,
        workflowRunId: request.session.workflowRunId,
        runtimeSessionId: request.session.id,
        provider: PI_MONO_PROVIDER,
        eventType: 'unparsed',
        stream: 'stdout',
        sequence,
        rawPayload: line,
        providerTimestamp: undefined,
        createdAt,
      })

      events.push({
        requestId: request.promptRequestId,
        workflowRunId: request.session.workflowRunId,
        runtimeSessionId: request.session.id,
        type: 'artifact.emitted',
        message: line,
        createdAt,
      })
    }

    sequence += 1
  }

  for (const rawStderrLine of output.stderr.split('\n')) {
    const line = rawStderrLine.replace(/\r$/, '')
    const trimmedLine = line.trim()

    if (trimmedLine.length === 0) {
      continue
    }

    const createdAt = baseCreatedAt + sequence

    providerEvents.push({
      requestId: request.promptRequestId,
      workflowRunId: request.session.workflowRunId,
      runtimeSessionId: request.session.id,
      provider: PI_MONO_PROVIDER,
      eventType: 'stderr',
      stream: 'stderr',
      sequence,
      rawPayload: line,
      providerTimestamp: undefined,
      createdAt,
    })

    events.push({
      requestId: request.promptRequestId,
      workflowRunId: request.session.workflowRunId,
      runtimeSessionId: request.session.id,
      type: output.exitCode === 0 ? 'artifact.emitted' : 'session.failed',
      message: trimmedLine,
      createdAt,
    })

    sequence += 1
  }

  return {
    providerEvents,
    events,
  }
}

function buildPiPromptCommand(command: string, prompt: string): string {
  const promptBase64 = Buffer.from(prompt, 'utf8').toString('base64')

  return [
    `PROMPT_B64='${promptBase64}'`,
    `PROMPT="$(node -e "process.stdout.write(Buffer.from(process.env.PROMPT_B64,'base64').toString('utf8'))")"`,
    `${command} --mode json --no-session "$PROMPT"`,
  ].join(' && ')
}

export class PiMonoRuntimeAdapter implements RuntimeAdapter {
  readonly name = 'pi-mono-runtime-adapter'

  constructor(private readonly options: PiMonoRuntimeOptions) {}

  createExecutionPlan(
    request: RuntimeExecutionRequest,
  ): Effect.Effect<RuntimeExecutionPlan, BoundaryFailure> {
    return Effect.try({
      try: () => ({
        command: buildPiPromptCommand(this.options.command, request.prompt),
        workingDirectory: request.workingDirectory,
        env: { ...request.env } satisfies RuntimeEnvironment,
      }),
      catch: (cause) =>
        toBoundaryFailure('Failed to build a Pi Mono execution plan.', cause),
    })
  }

  normalizeOutput(
    request: RuntimeExecutionRequest,
    output: RuntimeExecutionOutput,
  ): Effect.Effect<RuntimeNormalizationResult, BoundaryFailure> {
    return Effect.try({
      try: () => parsePiEventLines(request, output),
      catch: (cause) =>
        toBoundaryFailure('Failed to normalize Pi Mono output.', cause),
    })
  }
}
