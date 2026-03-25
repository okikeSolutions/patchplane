import { Effect } from 'effect'
import type {
  BoundaryFailure,
  RuntimeAdapter,
  RuntimeEnvironment,
  RuntimeEventInput,
  RuntimeExecutionOutput,
  RuntimeExecutionPlan,
  RuntimeExecutionRequest,
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

function toBoundaryFailure(message: string, cause: unknown): BoundaryFailure {
  return {
    boundary: 'runtime.pi-mono',
    message,
    retryable: true,
    cause,
  }
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
    case 'auto_compaction_start':
      return `Pi auto-compaction started${event.reason ? `: ${event.reason}` : ''}.`
    case 'auto_compaction_end':
      return event.aborted
        ? 'Pi auto-compaction aborted.'
        : 'Pi auto-compaction completed.'
    case 'message_update':
      return event.assistantMessageEvent?.type === 'text_delta' &&
        event.assistantMessageEvent.delta?.trim()
        ? event.assistantMessageEvent.delta.trim()
        : null
    case 'agent_end':
      return 'Pi agent completed.'
    default:
      return null
  }
}

function toRuntimeEventType(event: PiJsonEvent): RuntimeEventInput['type'] | null {
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
): RuntimeEventInput[] {
  const events: RuntimeEventInput[] = []
  const lines = output.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]

    if (!line) {
      continue
    }

    try {
      const event = JSON.parse(line) as PiJsonEvent
      const type = toRuntimeEventType(event)
      const message = toExecutionMessage(event)

      if (!type || !message) {
        continue
      }

      events.push({
        requestId: request.promptRequestId,
        workflowRunId: request.session.workflowRunId,
        runtimeSessionId: request.session.id,
        type,
        message,
        createdAt: Date.now() + index,
      })
    } catch {
      events.push({
        requestId: request.promptRequestId,
        workflowRunId: request.session.workflowRunId,
        runtimeSessionId: request.session.id,
        type: 'artifact.emitted',
        message: line,
        createdAt: Date.now() + index,
      })
    }
  }

  if (output.stderr.trim().length > 0) {
    events.push({
      requestId: request.promptRequestId,
      workflowRunId: request.session.workflowRunId,
      runtimeSessionId: request.session.id,
      type:
        output.exitCode === 0 ? 'artifact.emitted' : 'session.failed',
      message: output.stderr.trim(),
      createdAt: Date.now() + lines.length,
    })
  }

  return events
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
  ): Effect.Effect<ReadonlyArray<RuntimeEventInput>, BoundaryFailure> {
    return Effect.try({
      try: () => parsePiEventLines(request, output),
      catch: (cause) =>
        toBoundaryFailure('Failed to normalize Pi Mono output.', cause),
    })
  }
}
