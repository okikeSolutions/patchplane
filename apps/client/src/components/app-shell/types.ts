import type { Id } from '@patchplane/backend/convex/_generated/dataModel'

export interface ViewerIdentity {
  subject: string
  name: string
  email?: string
}

export interface ExternalWorkflowRefRow {
  provider: string
  deliveryId: string
  eventKind: string
  repositoryProvider?: string
  repositoryInstallationId?: string
  repositoryExternalId?: string
  repositoryOwner?: string
  repositoryName?: string
  repositoryFullName?: string
  issueExternalId?: string
  issueNumber?: number
  issueTitle?: string
  pullRequestExternalId?: string
  pullRequestNumber?: number
  pullRequestHeadSha?: string
  pullRequestHeadRef?: string
  pullRequestBaseRef?: string
  commentExternalId?: string
  url?: string
  senderProvider?: string
  senderExternalId?: string
  senderLogin?: string
}

export interface PromptRequestRow {
  id: string
  workspaceId: string
  actorId: string
  traceId: string
  source: 'dev' | 'app' | 'external'
  prompt: string
  externalRef?: ExternalWorkflowRefRow
  status: 'created'
  createdAt: number
}

export interface WorkflowRunRow {
  id: Id<'workflowRuns'>
  promptRequestId: string
  workspaceId: string
  traceId: string
  status: 'queued' | 'running' | 'reviewed'
  createdAt: number
}

export interface WorkflowStartRow {
  promptRequest: PromptRequestRow
  workflowRun: WorkflowRunRow
}

export interface RuntimeEventRow {
  id: string
  workflowRunId: Id<'workflowRuns'>
  provider: string
  type: string
  occurredAt: number
  summary?: string
  payloadJson?: string
  idempotencyKey?: string
  sourceSessionId?: string
  sourceCommandId?: string
  sourceStream?: 'stdout' | 'stderr'
  sourceLine?: number
  sourceOffset?: number
}

export interface RuntimeSessionRow {
  id: string
  workflowRunId: Id<'workflowRuns'>
  provider: string
  sandboxId: string
  sessionId: string
  commandId: string
  status: 'starting' | 'running' | 'completed' | 'failed' | 'cancelled'
  startedAt: number
  updatedAt: number
  completedAt?: number
}

export interface SandboxPolicyRow {
  lifecycle: {
    ephemeral: boolean
    retainAfterRun: boolean
    autoStopMinutes?: number
    autoArchiveMinutes?: number
    autoDeleteMinutes?: number
  }
  network: {
    blockAll?: boolean
    allowList?: string
  }
  resources: {
    cpu?: number
    memoryGb?: number
    diskGb?: number
  }
  timeoutSeconds?: number
}

export interface SandboxExecutionRow {
  id: string
  workflowRunId: Id<'workflowRuns'>
  provider: string
  sandboxId: string
  command: string
  status: 'succeeded' | 'failed'
  exitCode?: number
  stdout: string
  stderr?: string
  policy?: SandboxPolicyRow
  startedAt: number
  completedAt: number
}

export interface WorkflowDetail extends WorkflowStartRow {
  runtimeEvents: ReadonlyArray<RuntimeEventRow>
  runtimeSessions: ReadonlyArray<RuntimeSessionRow>
  sandboxExecutions: ReadonlyArray<SandboxExecutionRow>
}
