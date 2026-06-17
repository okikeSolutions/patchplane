import { Context, Effect } from 'effect'
import type { Actor } from '@patchplane/domain/actor'
import type { StorageError } from '@patchplane/domain/errors'
import type { ExternalWorkflowRef } from '@patchplane/domain/external-workflow-ref'
import type { WorkspaceId } from '@patchplane/domain/ids'
import type { ListRecentWorkflowStartsInput } from '@patchplane/domain/list-recent-workflow-starts'
import type { PromptRequestSource } from '@patchplane/domain/prompt-request'
import type { WorkflowIntake } from '@patchplane/domain/workflow-intake'
import type { WorkflowStart } from '@patchplane/domain/workflow-start'

export type { ListRecentWorkflowStartsInput }

export interface StorageListRecentWorkflowStartsInput
  extends ListRecentWorkflowStartsInput {
  readonly authToken?: string
}

export interface CreateWorkflowFromPromptInput {
  readonly actor: Actor
  readonly workspaceId: WorkspaceId
  readonly source: PromptRequestSource
  readonly traceId: string
  readonly prompt: string
  readonly externalRef?: ExternalWorkflowRef | undefined
  readonly authToken?: string
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
}>()('@patchplane/core/services/StorageService') {}
