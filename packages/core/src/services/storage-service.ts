import { Context, Effect } from 'effect'
import type { Actor } from '@patchplane/domain/actor'
import type { StorageError } from '@patchplane/domain/errors'
import type { ExternalWorkflowRef } from '@patchplane/domain/external-workflow-ref'
import type { WorkspaceId } from '@patchplane/domain/ids'
import type { ListRecentWorkflowStartsInput } from '@patchplane/domain/list-recent-workflow-starts'
import type { PromptRequestSource } from '@patchplane/domain/prompt-request'
import type { RuntimeEvent as StoredRuntimeEvent } from '@patchplane/domain/runtime-event'
import type { SandboxExecution } from '@patchplane/domain/sandbox-execution'
import type { SandboxPolicy } from '@patchplane/domain/sandbox-policy'
import type { WorkflowIntake } from '@patchplane/domain/workflow-intake'
import type { WorkflowStart } from '@patchplane/domain/workflow-start'
import type { TelemetryContextFields } from './telemetry-service'

export type { ListRecentWorkflowStartsInput }

export interface StorageListRecentWorkflowStartsInput
  extends ListRecentWorkflowStartsInput, TelemetryContextFields {
  readonly authToken?: string
}

export interface CreateWorkflowFromPromptInput extends TelemetryContextFields {
  readonly actor: Actor
  readonly workspaceId: WorkspaceId
  readonly source: PromptRequestSource
  readonly traceId: string
  readonly prompt: string
  readonly externalRef?: ExternalWorkflowRef | undefined
  readonly authToken?: string
}

export interface RecordSandboxExecutionInput extends TelemetryContextFields {
  readonly workflowRunId: string
  readonly provider: string
  readonly sandboxId: string
  readonly command: string
  readonly status: 'succeeded' | 'failed'
  readonly exitCode?: number | undefined
  readonly stdout: string
  readonly stderr?: string | undefined
  readonly policy?: SandboxPolicy | undefined
  readonly startedAt: number
  readonly completedAt: number
}

export interface RecordRuntimeEventInput extends TelemetryContextFields {
  readonly workflowRunId: string
  readonly provider: string
  readonly type: string
  readonly occurredAt: number
  readonly summary?: string | undefined
  readonly payloadJson?: string | undefined
}

export class StorageService extends Context.Service<StorageService, {
  readonly createWorkflowFromIntake: (
    input: WorkflowIntake,
  ) => Effect.Effect<WorkflowStart, StorageError>
  readonly createWorkflowFromPrompt: (
    input: CreateWorkflowFromPromptInput,
  ) => Effect.Effect<WorkflowStart, StorageError>
  readonly listRecentWorkflowStarts: (
    input: StorageListRecentWorkflowStartsInput,
  ) => Effect.Effect<ReadonlyArray<WorkflowStart>, StorageError>
  readonly recordSandboxExecution: (
    input: RecordSandboxExecutionInput,
  ) => Effect.Effect<SandboxExecution, StorageError>
  readonly recordRuntimeEvents: (
    input: ReadonlyArray<RecordRuntimeEventInput>,
  ) => Effect.Effect<ReadonlyArray<StoredRuntimeEvent>, StorageError>
}>()('@patchplane/core/services/StorageService') {}
