import { Effect } from 'effect'
import type {
  RuntimeEventInput,
  RuntimeProviderEventInput,
} from '@patchplane/domain'
import type { ReviewEvaluationInput } from './evaluate'

export interface RuntimeReviewerContext {
  readonly normalizedEvents: ReadonlyArray<RuntimeEventInput>
  readonly providerEvents: ReadonlyArray<RuntimeProviderEventInput>
}

interface RuntimeReviewerRunner {
  readonly reviewer: string
  run(
    context: RuntimeReviewerContext,
  ): Effect.Effect<ReviewEvaluationInput, never>
}

interface QueueUpdatePayload {
  readonly type: 'queue_update'
  readonly steering?: ReadonlyArray<string>
  readonly followUp?: ReadonlyArray<string>
}

interface PiToolExecutionStartPayload {
  readonly type: 'tool_execution_start'
  readonly toolName?: string
  readonly args?: unknown
}

interface PiToolExecutionEndPayload {
  readonly type: 'tool_execution_end'
  readonly toolName?: string
  readonly isError?: boolean
}

const SHELL_TOOL_NAMES = new Set(['bash', 'shell', 'exec_command', 'command'])
const DESTRUCTIVE_COMMAND_PATTERNS: ReadonlyArray<RegExp> = [
  /\brm\s+-rf\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+checkout\s+--\b/i,
  /\bcurl\b[\s\S]{0,120}\|\s*(?:bash|sh)\b/i,
  /\bsudo\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=\/dev\/zero\b/i,
  /\bchmod\s+777\b/i,
]

function parsePiPayload<T extends { readonly type: string }>(
  providerEvent: RuntimeProviderEventInput,
  eventType: T['type'],
): T | null {
  if (
    providerEvent.provider !== 'pi-mono' ||
    providerEvent.eventType !== eventType
  ) {
    return null
  }

  try {
    const payload = JSON.parse(providerEvent.rawPayload) as T
    return payload.type === eventType ? payload : null
  } catch {
    return null
  }
}

function hasRuntimeFailure(
  normalizedEvents: ReadonlyArray<RuntimeEventInput>,
): boolean {
  return normalizedEvents.some(
    (event) => event.type === 'session.failed' || event.type === 'turn.failed',
  )
}

function summarizeRuntimeFailures(
  normalizedEvents: ReadonlyArray<RuntimeEventInput>,
): string {
  return normalizedEvents
    .filter(
      (event) =>
        event.type === 'session.failed' || event.type === 'turn.failed',
    )
    .map((event) => event.message)
    .join(' ')
}

export function summarizeQueueMessagesFromProviderEvents(
  providerEvents: ReadonlyArray<RuntimeProviderEventInput>,
): ReadonlyArray<string> {
  const latestQueueUpdate = providerEvents.reduce<{
    readonly payload: QueueUpdatePayload
    readonly sequence: number
  } | null>((latest, providerEvent) => {
    const payload = parsePiPayload<QueueUpdatePayload>(
      providerEvent,
      'queue_update',
    )

    if (!payload) {
      return latest
    }

    if (!latest || providerEvent.sequence >= latest.sequence) {
      return {
        payload,
        sequence: providerEvent.sequence,
      }
    }

    return latest
  }, null)

  if (!latestQueueUpdate) {
    return []
  }

  return [
    ...(latestQueueUpdate.payload.steering ?? []).map(
      (message) => `Steering: ${message}`,
    ),
    ...(latestQueueUpdate.payload.followUp ?? []).map(
      (message) => `Follow-up: ${message}`,
    ),
  ]
}

function collectToolExecutionErrors(
  providerEvents: ReadonlyArray<RuntimeProviderEventInput>,
): ReadonlyArray<string> {
  return providerEvents
    .map((providerEvent) =>
      parsePiPayload<PiToolExecutionEndPayload>(
        providerEvent,
        'tool_execution_end',
      ),
    )
    .filter(
      (payload): payload is PiToolExecutionEndPayload =>
        payload !== null && payload.isError === true,
    )
    .map((payload) => payload.toolName ?? 'unknown')
}

function extractShellCommand(args: unknown): string | undefined {
  if (!args || typeof args !== 'object') {
    return undefined
  }

  const shellArgs = args as Record<string, unknown>
  const candidateKeys = ['command', 'cmd', 'script', 'commandLine']

  for (const key of candidateKeys) {
    const value = shellArgs[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }

  return undefined
}

function collectSuspiciousCommands(
  providerEvents: ReadonlyArray<RuntimeProviderEventInput>,
): ReadonlyArray<string> {
  return providerEvents
    .map((providerEvent) =>
      parsePiPayload<PiToolExecutionStartPayload>(
        providerEvent,
        'tool_execution_start',
      ),
    )
    .filter(
      (payload): payload is PiToolExecutionStartPayload => payload !== null,
    )
    .flatMap((payload) => {
      if (!payload.toolName || !SHELL_TOOL_NAMES.has(payload.toolName)) {
        return []
      }

      const command = extractShellCommand(payload.args)
      if (!command) {
        return []
      }

      return DESTRUCTIVE_COMMAND_PATTERNS.some((pattern) =>
        pattern.test(command),
      )
        ? [command]
        : []
    })
}

const qualityReviewerRunner: RuntimeReviewerRunner = {
  reviewer: 'quality',
  run: (context) =>
    Effect.sync<ReviewEvaluationInput>(() => {
      const queueMessages = summarizeQueueMessagesFromProviderEvents(
        context.providerEvents,
      )
      const toolErrors = collectToolExecutionErrors(context.providerEvents)

      if (hasRuntimeFailure(context.normalizedEvents)) {
        return {
          reviewer: 'quality',
          score: 0.2,
          passed: false,
          summary:
            `Runtime execution failed. ${summarizeRuntimeFailures(context.normalizedEvents)}`.trim(),
        }
      }

      if (toolErrors.length > 0) {
        return {
          reviewer: 'quality',
          score: 0.45,
          passed: false,
          summary: `One or more runtime tools failed: ${toolErrors.join(', ')}.`,
        }
      }

      if (queueMessages.length > 0) {
        return {
          reviewer: 'quality',
          score: 0.6,
          passed: false,
          summary:
            `Runtime finished with queued follow-up messages. ${queueMessages.join(' ')}`.trim(),
        }
      }

      return {
        reviewer: 'quality',
        score: 0.95,
        passed: true,
        summary:
          'Runtime execution completed without failure signals or pending follow-up work.',
      }
    }),
}

const securityReviewerRunner: RuntimeReviewerRunner = {
  reviewer: 'security',
  run: (context) =>
    Effect.sync<ReviewEvaluationInput>(() => {
      const suspiciousCommands = collectSuspiciousCommands(
        context.providerEvents,
      )

      if (suspiciousCommands.length > 0) {
        const preview = suspiciousCommands.slice(0, 2).join(' | ')

        return {
          reviewer: 'security',
          score: 0.15,
          passed: false,
          summary: `Potentially destructive shell commands were observed during runtime execution: ${preview}.`,
        }
      }

      return {
        reviewer: 'security',
        score: 0.9,
        passed: true,
        summary:
          'No destructive shell command patterns were observed in runtime tool execution.',
      }
    }),
}

const runtimeReviewerRunners = new Map<string, RuntimeReviewerRunner>(
  [qualityReviewerRunner, securityReviewerRunner].map((runner) => [
    runner.reviewer,
    runner,
  ]),
)

export function runConfiguredRuntimeReviewers(
  reviewers: ReadonlyArray<string>,
  context: RuntimeReviewerContext,
) {
  const distinctReviewers = [...new Set(reviewers)]

  return Effect.forEach(
    distinctReviewers,
    (reviewer) => {
      const runner = runtimeReviewerRunners.get(reviewer)
      return runner
        ? runner.run(context).pipe(Effect.map((reviewRun) => reviewRun))
        : Effect.succeed<ReviewEvaluationInput | null>(null)
    },
    { concurrency: 'unbounded' },
  ).pipe(
    Effect.map((reviewRuns) =>
      reviewRuns.filter(
        (reviewRun): reviewRun is ReviewEvaluationInput => reviewRun !== null,
      ),
    ),
  )
}
